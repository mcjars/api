use super::State;
use utoipa_axum::{router::OpenApiRouter, routes};

mod post {
    use crate::{
        models::{
            BaseModel, build::Build, config::Format, r#type::ServerType, version::MinifiedVersion,
        },
        routes::{ApiError, GetState},
    };
    use axum::http::StatusCode;
    use indexmap::IndexMap;
    use serde::{Deserialize, Serialize};
    use sha1::Digest;
    use sqlx::Row;
    use utoipa::ToSchema;

    #[derive(ToSchema, Serialize, Deserialize)]
    pub struct Hash {
        primary: Option<bool>,
        sha1: Option<String>,
        sha224: Option<String>,
        sha256: Option<String>,
        sha384: Option<String>,
        sha512: Option<String>,
        md5: Option<String>,
    }

    impl Hash {
        pub fn any(&self) -> bool {
            self.sha1.is_some()
                || self.sha224.is_some()
                || self.sha256.is_some()
                || self.sha384.is_some()
                || self.sha512.is_some()
                || self.md5.is_some()
        }
    }

    #[derive(ToSchema, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    #[schema(rename_all = "camelCase")]
    pub struct BuildSearch {
        id: Option<u32>,
        r#type: Option<ServerType>,
        version_id: Option<String>,
        project_version_id: Option<String>,
        build_number: Option<u32>,
        experimental: Option<bool>,
        jar_url: Option<String>,
        jar_size: Option<u32>,
        zip_url: Option<String>,
        zip_size: Option<u32>,

        #[schema(inline)]
        hash: Option<Hash>,
    }

    impl BuildSearch {
        pub fn any(&self) -> bool {
            self.id.is_some()
                || self.r#type.is_some()
                || self.version_id.is_some()
                || self.project_version_id.is_some()
                || self.build_number.is_some()
                || self.experimental.is_some()
                || self.jar_url.is_some()
                || self.jar_size.is_some()
                || self.zip_url.is_some()
                || self.zip_size.is_some()
                || self.hash.as_ref().map(|h| h.any()).unwrap_or(false)
        }
    }

    #[derive(ToSchema, Serialize, Deserialize)]
    #[serde(untagged)]
    pub enum Payload {
        One(#[schema(inline)] Box<BuildSearch>),
        Many(#[schema(inline)] Vec<BuildSearch>),
    }

    #[derive(ToSchema, Serialize, Deserialize)]
    struct ConfigValue {
        r#type: ServerType,
        format: Format,
        value: String,
    }

    #[derive(ToSchema, Serialize, Deserialize)]
    struct Result {
        build: Build,
        latest: Build,
        version: MinifiedVersion,

        #[schema(inline)]
        configs: IndexMap<String, ConfigValue>,
    }

    #[derive(ToSchema, Serialize, Deserialize)]
    struct ResponseOne {
        success: bool,
        build: Build,
        latest: Build,
        version: MinifiedVersion,

        #[schema(inline)]
        configs: IndexMap<String, ConfigValue>,
    }

    #[derive(ToSchema, Serialize, Deserialize)]
    struct ResponseMany {
        success: bool,
        builds: Vec<Option<Result>>,
    }

    #[utoipa::path(post, path = "/", responses(
        (status = OK, body = inline(ResponseOne)),
        (status = MULTI_STATUS, body = inline(ResponseMany)),
        (status = PAYLOAD_TOO_LARGE, body = inline(ApiError)),
        (status = NOT_FOUND, body = inline(ApiError)),
    ), request_body = inline(Payload))]
    pub async fn route(
        state: GetState,
        axum::Json(data): axum::Json<Payload>,
    ) -> (StatusCode, axum::Json<serde_json::Value>) {
        match data {
            Payload::One(search) => {
                if let Some(result) = lookup_build(&state.database, &state.cache, *search).await {
                    (
                        StatusCode::OK,
                        axum::Json(
                            serde_json::to_value(&ResponseOne {
                                success: true,
                                build: result.build,
                                latest: result.latest,
                                version: result.version,
                                configs: result.configs,
                            })
                            .unwrap(),
                        ),
                    )
                } else {
                    (
                        StatusCode::NOT_FOUND,
                        axum::Json(ApiError::new(&["build not found"]).to_value()),
                    )
                }
            }
            Payload::Many(searches) => {
                if searches.len() > 10 {
                    return (
                        StatusCode::PAYLOAD_TOO_LARGE,
                        axum::Json(
                            ApiError::new(&["you can only search for up to 10 builds at a time"])
                                .to_value(),
                        ),
                    );
                }

                let mut results = Vec::with_capacity(searches.len());
                for search in searches {
                    results.push(lookup_build(&state.database, &state.cache, search));
                }

                let results = futures_util::future::join_all(results).await;

                (
                    StatusCode::MULTI_STATUS,
                    axum::Json(
                        serde_json::to_value(&ResponseMany {
                            success: true,
                            builds: results,
                        })
                        .unwrap(),
                    ),
                )
            }
        }
    }

    fn escape_string(s: &str) -> String {
        s.replace('\'', "''")
    }

    async fn lookup_build(
        database: &crate::database::Database,
        cache: &crate::cache::Cache,
        search: BuildSearch,
    ) -> Option<Result> {
        if !search.any() {
            return None;
        }

        let mut sha1 = sha1::Sha1::new();
        sha1.update(serde_json::to_string(&search).unwrap().as_bytes());
        let identifier = format!("{:x}", sha1.finalize());

        cache.cached(&format!("build::{}", identifier), 3600, || async {
            let mut where_clause: Vec<String> = Vec::new();

            if let Some(id) = search.id {
                where_clause.push(format!("builds.id = {}", id));
            }
            if let Some(r#type) = search.r#type {
                where_clause.push(format!("builds.type = '{}'", r#type));
            }
            if let Some(version_id) = &search.version_id {
                where_clause.push(format!("builds.version_id = '{}'", escape_string(version_id)));
            }
            if let Some(project_version_id) = &search.project_version_id {
                where_clause.push(format!("builds.project_version_id = '{}'", escape_string(project_version_id)));
            }
            if let Some(build_number) = search.build_number {
                where_clause.push(format!("builds.build_number = {}", build_number));
            }
            if let Some(experimental) = search.experimental {
                where_clause.push(format!("builds.experimental = {}", experimental));
            }
            if let Some(jar_url) = &search.jar_url {
                where_clause.push(format!("builds.jar_url = '{}'", escape_string(jar_url)));
            }
            if let Some(jar_size) = search.jar_size {
                where_clause.push(format!("builds.jar_size = {}", jar_size));
            }
            if let Some(zip_url) = &search.zip_url {
                where_clause.push(format!("builds.zip_url = '{}'", escape_string(zip_url)));
            }
            if let Some(zip_size) = search.zip_size {
                where_clause.push(format!("builds.zip_size = {}", zip_size));
            }
            if let Some(hash) = &search.hash {
                if hash.any() {
                    if let Some(primary) = hash.primary {
                        where_clause.push(format!("build_hashes.primary = {}", primary));
                    }
                    if let Some(sha1) = &hash.sha1 {
                        where_clause.push(format!("build_hashes.sha1 = '{}'", sha1));
                    }
                    if let Some(sha224) = &hash.sha224 {
                        where_clause.push(format!("build_hashes.sha224 = '{}'", sha224));
                    }
                    if let Some(sha256) = &hash.sha256 {
                        where_clause.push(format!("build_hashes.sha256 = '{}'", sha256));
                    }
                    if let Some(sha384) = &hash.sha384 {
                        where_clause.push(format!("build_hashes.sha384 = '{}'", sha384));
                    }
                    if let Some(sha512) = &hash.sha512 {
                        where_clause.push(format!("build_hashes.sha512 = '{}'", sha512));
                    }
                    if let Some(md5) = &hash.md5 {
                        where_clause.push(format!("build_hashes.md5 = '{}'", md5));
                    }
                }
            }

            let query = sqlx::query(&format!(
                r#"
                WITH spec_build AS (
                    SELECT {}
                    FROM {}
                    WHERE {}
                    ORDER BY builds.id DESC
                    LIMIT 1
                ),
    
                filtered_builds AS (
                    SELECT {}
                    FROM builds b
                    INNER JOIN spec_build sb ON
                        sb.id = b.id
                        OR (COALESCE(sb.version_id, sb.project_version_id) = COALESCE(b.version_id, b.project_version_id) AND sb.type = b.type::text)
                    WHERE b.type <> 'ARCLIGHT'
                        OR split_part(sb.project_version_id, '-', -1) = split_part(b.project_version_id, '-', -1)
                        OR split_part(sb.project_version_id, '-', -1) NOT IN ('forge', 'neoforge', 'fabric')
                ),

                build_count AS (
                    SELECT count(*) AS count
                    FROM builds
                    WHERE COALESCE(version_id, project_version_id) = COALESCE(
                        (SELECT version_id FROM spec_build),
                        (SELECT project_version_id FROM spec_build)
                    )
                )
    
                SELECT
                    *,
                    0 AS build_count,
                    now()::timestamp as version2_created,
                    'RELEASE' AS version_type,
                    false AS version_supported,
                    0 AS version_java,
                    now()::timestamp AS version_created
                FROM spec_build
    
                UNION ALL
    
                SELECT
                    x.*,
                    mv.type::text AS version_type,
                    mv.supported AS version_supported,
                    mv.java AS version_java,
                    mv.created AS version_created
                FROM (
                    SELECT *
                    FROM (
                        SELECT
                            {},
                            (SELECT count FROM build_count) AS build_count,
                            min(b.created) OVER () AS version2_created
                        FROM filtered_builds b
                        ORDER BY b.id DESC
                    ) LIMIT 1
                ) x
                LEFT JOIN minecraft_versions mv ON mv.id = x.version_id
                "#,
                Build::columns_sql(None, None),
                if search.hash.as_ref().map(|h| h.any()).unwrap_or(false) {
                    "build_hashes INNER JOIN builds ON builds.id = build_hashes.build_id"
                } else {
                    "builds"
                },
                where_clause.join(" AND "),
                Build::columns_sql(None, Some("b")),
                Build::columns_sql(None, Some("b"))
            ))
            .bind(identifier)
            .fetch_all(database.read())
            .await
            .unwrap();

            if query.len() != 2 {
                return None;
            }

            let mut configs = IndexMap::new();
            for row in sqlx::query(
                r#"
                SELECT
                    configs.type::text AS type,
                    configs.format::text AS format,
                    configs.location AS location,
                    config_values.value AS value
                FROM config_values
                INNER JOIN build_configs ON build_configs.config_value_id = config_values.id
                INNER JOIN configs ON configs.id = config_values.config_id
                WHERE build_configs.build_id = $1
                ORDER BY configs.id ASC
                "#,
            )
            .bind(query[0].get::<i32, _>("id"))
            .fetch_all(database.read())
            .await
            .unwrap()
            {
                let r#type = serde_json::from_value(serde_json::Value::String(row.get("type"))).unwrap();
                let format = serde_json::from_value(serde_json::Value::String(row.get("format"))).unwrap();
                let value = row.get("value");

                configs.insert(
                    row.get("location"),
                    ConfigValue { r#type, format, value },
                );
            }

            Some(Result {
                build: Build::map(None, &query[0]),
                latest: Build::map(None, &query[1]),
                version: crate::models::version::MinifiedVersion {
                    id: query[1]
                        .try_get("version_id")
                        .unwrap_or_else(|_| query[1].get("project_version_id")),
                    r#type: serde_json::from_value(serde_json::Value::String(
                        query[1]
                            .try_get("version_type")
                            .unwrap_or("RELEASE".to_string()),
                    ))
                    .unwrap(),
                    supported: query[1].try_get("version_supported").unwrap_or(true),
                    java: query[1].try_get("version_java").unwrap_or(21),
                    builds: query[1].try_get("build_count").unwrap_or(0),
                    created: query[1]
                        .try_get("version_created")
                        .unwrap_or(query[1].try_get("version2_created").unwrap_or_default()),
                },
                configs
            })
        })
        .await
    }
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .routes(routes!(post::route))
        .with_state(state.clone())
}
