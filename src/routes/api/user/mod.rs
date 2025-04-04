use super::{ApiError, GetState, State};
use crate::models::user::User;
use axum::{body::Body, extract::Request, http::StatusCode, middleware::Next, response::Response};
use tower_cookies::{Cookie, Cookies};
use utoipa_axum::{router::OpenApiRouter, routes};

mod invites;
mod logout;
mod organizations;

pub type GetUser = axum::extract::Extension<User>;

async fn auth(
    state: GetState,
    cookies: Cookies,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let session_id = cookies
        .get("session")
        .map(|c| c.value().to_string())
        .unwrap_or_default();

    if session_id.len() != 64 {
        return Ok(Response::builder()
            .status(StatusCode::UNAUTHORIZED)
            .header("Content-Type", "application/json")
            .body(Body::from(
                serde_json::to_string(&ApiError::new(&["invalid authorization cookie"])).unwrap(),
            ))
            .unwrap());
    }

    let user = state
        .cache
        .cached(&format!("user::session::{}", session_id), 300, || {
            User::by_session(&state.database, &session_id)
        })
        .await;

    if user.is_none() {
        return Ok(Response::builder()
            .status(StatusCode::UNAUTHORIZED)
            .header("Content-Type", "application/json")
            .body(Body::from(
                serde_json::to_string(&ApiError::new(&["unauthorized"])).unwrap(),
            ))
            .unwrap());
    }

    let (user, mut session) = user.unwrap();
    session.ip = req
        .headers()
        .get("x-real-ip")
        .or_else(|| req.headers().get("x-forwarded-for"))
        .map(|ip| ip.to_str().unwrap_or_default())
        .unwrap_or_default()
        .to_string()
        .parse()
        .unwrap();
    session.user_agent = req
        .headers()
        .get("user-agent")
        .map(|ua| ua.to_str().unwrap_or_default())
        .unwrap_or_default()
        .to_string();
    session.save(&state.database).await;

    cookies.add(
        Cookie::build(("session", session_id))
            .http_only(true)
            .same_site(tower_cookies::cookie::SameSite::Lax)
            .secure(true)
            .domain(state.env.app_cookie_domain.clone())
            .path("/")
            .expires(
                tower_cookies::cookie::time::OffsetDateTime::now_utc()
                    + tower_cookies::cookie::time::Duration::days(7),
            )
            .build(),
    );

    req.extensions_mut().insert(user);

    Ok(next.run(req).await)
}

mod get {
    use super::GetUser;
    use crate::models::user::ApiUser;
    use serde::{Deserialize, Serialize};
    use utoipa::ToSchema;

    #[derive(ToSchema, Serialize, Deserialize)]
    struct Response {
        success: bool,
        user: ApiUser,
    }

    #[utoipa::path(get, path = "/", responses(
        (status = OK, body = inline(Response)),
    ))]
    pub async fn route(user: GetUser) -> axum::Json<serde_json::Value> {
        axum::Json(
            serde_json::to_value(&Response {
                success: true,
                user: user.api_user(false),
            })
            .unwrap(),
        )
    }
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .routes(routes!(get::route))
        .nest("/logout", logout::router(state))
        .nest("/invites", invites::router(state))
        .nest("/organizations", organizations::router(state))
        .route_layer(axum::middleware::from_fn_with_state(state.clone(), auth))
        .with_state(state.clone())
}
