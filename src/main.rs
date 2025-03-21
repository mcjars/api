mod cache;
mod database;
mod env;
mod logger;
mod models;
mod requests;
mod routes;
mod s3;

use axum::{
    body::Body,
    extract::{Path, Request},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
    routing::get,
};
use colored::Colorize;
use models::r#type::ServerType;
use routes::{ApiError, GetState};
use sentry_tower::SentryHttpLayer;
use sha1::Digest;
use std::{sync::Arc, time::Instant};
use tower_cookies::CookieManagerLayer;
use tower_http::{catch_panic::CatchPanicLayer, cors::CorsLayer, trace::TraceLayer};
use utoipa::openapi::security::{ApiKey, ApiKeyValue, SecurityScheme};
use utoipa_axum::router::OpenApiRouter;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const GIT_COMMIT: &str = env!("CARGO_GIT_COMMIT");
const BLACKLISTED_HEADERS: [&str; 3] = ["content-encoding", "transfer-encoding", "connection"];

fn handle_panic(_err: Box<dyn std::any::Any + Send + 'static>) -> Response<Body> {
    logger::log(
        logger::LoggerLevel::Error,
        "a request panic has occurred".bright_red().to_string(),
    );

    let body = routes::ApiError::new(&["internal server error"]);
    let body = serde_json::to_string(&body).unwrap();

    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .header("Content-Type", "application/json")
        .body(Body::from(body))
        .unwrap()
}

fn handle_request(req: &Request<Body>, _span: &tracing::Span) {
    let ip = req
        .headers()
        .get("x-real-ip")
        .or_else(|| req.headers().get("x-forwarded-for"))
        .map(|ip| ip.to_str().unwrap_or_default())
        .unwrap_or_default();

    logger::log(
        logger::LoggerLevel::Info,
        format!(
            "{} {}{} {}",
            format!("HTTP {}", req.method()).green().bold(),
            req.uri().path().cyan(),
            if let Some(query) = req.uri().query() {
                format!("?{}", query)
            } else {
                "".to_string()
            }
            .bright_cyan(),
            format!("({})", ip).bright_black(),
        ),
    );
}

async fn handle_postprocessing(req: Request, next: Next) -> Result<Response, StatusCode> {
    let if_none_match = req.headers().get("If-None-Match").cloned();

    let mut response = next.run(req).await;
    let mut hash = sha1::Sha1::new();

    if let Some(content_type) = response.headers().get("Content-Type").cloned() {
        if content_type
            .to_str()
            .map(|c| c.starts_with("text/plain"))
            .unwrap_or(false)
            && response.status().is_client_error()
        {
            let (mut parts, body) = response.into_parts();

            let text_body = String::from_utf8(
                axum::body::to_bytes(body, usize::MAX)
                    .await
                    .unwrap()
                    .into_iter()
                    .by_ref()
                    .collect::<Vec<u8>>(),
            )
            .unwrap();

            parts
                .headers
                .insert("Content-Type", "application/json".parse().unwrap());

            response = Response::from_parts(
                parts,
                Body::from(ApiError::new(&[&text_body]).to_value().to_string()),
            );
        }
    }

    let (mut parts, body) = response.into_parts();
    let body_bytes = axum::body::to_bytes(body, usize::MAX).await.unwrap();

    hash.update(body_bytes.as_ref());
    let hash = format!("{:x}", hash.finalize());

    parts.headers.insert("ETag", hash.parse().unwrap());

    if if_none_match == Some(hash.parse().unwrap()) {
        let mut cached_response = Response::builder()
            .status(StatusCode::NOT_MODIFIED)
            .body(Body::empty())
            .unwrap();

        for (key, value) in parts.headers.iter() {
            cached_response.headers_mut().insert(key, value.clone());
        }

        return Ok(cached_response);
    }

    Ok(Response::from_parts(parts, Body::from(body_bytes)))
}

#[tokio::main]
async fn main() {
    let env = env::Env::parse();

    let _guard = sentry::init((
        env.sentry_url.clone(),
        sentry::ClientOptions {
            server_name: env.server_name.clone().map(|s| s.into()),
            release: Some(format!("{}:{}", VERSION, GIT_COMMIT).into()),
            traces_sample_rate: 1.0,
            ..Default::default()
        },
    ));

    let env = Arc::new(env);
    let s3 = Arc::new(s3::S3::new(env.clone()).await);
    let database = Arc::new(database::Database::new(env.clone()).await);
    let cache = Arc::new(cache::Cache::new(env.clone()).await);

    let state = Arc::new(routes::AppState {
        start_time: Instant::now(),
        version: format!("{}:{}", VERSION, GIT_COMMIT),

        database: database.clone(),
        cache: cache.clone(),
        requests: requests::RequestLogger::new(database.clone(), cache.clone()),
        env,
        s3,
    });

    {
        let state = state.clone();

        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;

                state.requests.process().await;
            }
        });
    }

    let app = OpenApiRouter::new()
        .nest("/api", routes::router(&state))
        .route(
            "/",
            get(|| async move {
                let mut headers = HeaderMap::new();

                headers.insert("Content-Type", "text/html".parse().unwrap());

                (
                    StatusCode::OK,
                    headers,
                    include_str!("../static/index.html"),
                )
            }),
        )
        .route(
            "/icons/{type}",
            get(|state: GetState, Path::<ServerType>(r#type)| async move {
                let mut headers = HeaderMap::new();

                headers.insert(
                    "Location",
                    format!(
                        "{}/icons/{}.png",
                        state.env.s3_url,
                        r#type.to_string().to_lowercase()
                    )
                    .parse()
                    .unwrap(),
                );

                (StatusCode::FOUND, headers, "")
            }),
        )
        .route(
            "/download/fabric/{version}/{project_version}/{installer_version}",
            get(
                |Path::<(String, String, String)>((
                    version,
                    project_version,
                    installer_version,
                ))| async move {
                    let mut headers = HeaderMap::new();

                    let response = reqwest::get(
                        format!(
                            "https://meta.fabricmc.net/v2/versions/loader/{}/{}/{}/server/jar",
                            version,
                            project_version,
                            installer_version.replace(".jar", "")
                        )
                        .as_str(),
                    )
                    .await
                    .unwrap();

                    if !response.status().is_success() {
                        return (
                            StatusCode::NOT_FOUND,
                            headers,
                            Body::from("build not found".to_string().into_bytes()),
                        );
                    }

                    for (key, value) in response.headers().iter() {
                        if !BLACKLISTED_HEADERS.contains(&key.as_str()) {
                            headers.insert(key, value.clone());
                        }
                    }

                    (
                        response.status(),
                        headers,
                        Body::from(response.bytes().await.unwrap().to_vec()),
                    )
                },
            ),
        )
        .fallback(|| async {
            (
                StatusCode::NOT_FOUND,
                axum::Json(ApiError::new(&["route not found"])),
            )
        })
        .layer(CatchPanicLayer::custom(handle_panic))
        .layer(CorsLayer::very_permissive())
        .layer(TraceLayer::new_for_http().on_request(handle_request))
        .layer(CookieManagerLayer::new())
        .route_layer(axum::middleware::from_fn(handle_postprocessing))
        .route_layer(SentryHttpLayer::with_transaction())
        .with_state(state.clone());

    let listener = tokio::net::TcpListener::bind(format!("{}:{}", &state.env.bind, state.env.port))
        .await
        .unwrap();

    logger::log(
        logger::LoggerLevel::Info,
        format!(
            "{} listening on {} {}",
            "http server".bright_red(),
            listener.local_addr().unwrap().to_string().cyan(),
            format!(
                "(app@{}, {}ms)",
                VERSION,
                state.start_time.elapsed().as_millis()
            )
            .bright_black()
        ),
    );

    let (router, mut openapi) = app.split_for_parts();
    openapi.info.version = state.version.clone();
    openapi.info.description = None;
    openapi.info.title = "MCJars API".to_string();
    openapi.info.contact = None;
    openapi.info.license = None;
    openapi.servers = Some(vec![utoipa::openapi::Server::new(
        state.env.app_url.clone(),
    )]);
    openapi.components.as_mut().unwrap().add_security_scheme(
        "api_key",
        SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::new("Authorization"))),
    );

    let router = router.route("/openapi.json", get(|| async move { axum::Json(openapi) }));

    axum::serve(listener, router.into_make_service())
        .await
        .unwrap();
}
