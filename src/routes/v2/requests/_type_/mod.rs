use super::State;
use utoipa_axum::{router::OpenApiRouter, routes};

mod history;

mod get {
    use crate::{
        models::r#type::{SERVER_TYPES_WITH_PROJECT_AS_IDENTIFIER, ServerType},
        routes::GetState,
    };
    use axum::extract::Path;
    use indexmap::IndexMap;
    use serde::{Deserialize, Serialize};
    use sqlx::Row;
    use utoipa::ToSchema;

    #[derive(sqlx::FromRow, Serialize, Deserialize)]
    struct Id {
        id: String,
    }

    #[derive(ToSchema, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TypeStats {
        total: i64,
        unique_ips: i64,
    }

    #[derive(ToSchema, Serialize, Deserialize)]
    struct Requests {
        #[schema(inline)]
        root: TypeStats,

        #[schema(inline)]
        versions: IndexMap<String, TypeStats>,
    }

    #[derive(ToSchema, Serialize, Deserialize)]
    struct Response {
        success: bool,

        #[schema(inline)]
        requests: Requests,
    }

    #[utoipa::path(get, path = "/", responses(
        (status = OK, body = inline(Response)),
    ), params(
        (
            "type" = ServerType,
            description = "The server type",
            example = "VANILLA",
        ),
    ))]
    pub async fn route(
        state: GetState,
        Path(r#type): Path<ServerType>,
    ) -> axum::Json<serde_json::Value> {
        let requests = state
            .cache
            .cached(&format!("requests::types::{}", r#type), 10800, || async {
                let project_key = format!("versions::all::project::{}", r#type);
                let (data, minecraft_versions, project_versions) = tokio::join!(
                    sqlx::query(
                        r#"
                        SELECT
                            COUNT(*) AS total,
                            COUNT(DISTINCT ip) AS unique_ips,
                            CASE
                                WHEN LENGTH(requests.path) > $1
                                THEN UPPER(
                                    SPLIT_PART(
                                        SPLIT_PART(
                                            SUBSTR(requests.path, $1 + 1),
                                            '?',
                                            1
                                        ),
                                        '/',
                                        1
                                    )
                                )
                                ELSE '/'
                            END AS version
                        FROM requests
                        WHERE
                            requests.status = 200
                            AND requests.data IS NOT NULL
                            AND requests.path NOT LIKE '%tracking=nostats%'
                            AND requests.path LIKE '/api/v_/builds/' || $2 || '%'
                        GROUP BY version
                        ORDER BY total DESC
                        "#,
                    )
                    .bind(format!("/api/v_/builds/{}/", r#type).len() as i32)
                    .bind(r#type.to_string())
                    .fetch_all(state.database.read()),
                    state
                        .cache
                        .cached("versions::all::minecraft", 10800, || async {
                            let data: Vec<Id> = sqlx::query_as(
                                r#"
                                SELECT id
                                FROM minecraft_versions
                                "#,
                            )
                            .fetch_all(state.database.read())
                            .await
                            .unwrap();

                            data
                        }),
                    state.cache.cached(&project_key, 10800, || async {
                        if !SERVER_TYPES_WITH_PROJECT_AS_IDENTIFIER.contains(&r#type) {
                            return Vec::new();
                        }

                        let data: Vec<Id> = sqlx::query_as(
                            r#"
                            SELECT id
                            FROM project_versions
                            WHERE type = $1::server_type
                            "#,
                        )
                        .bind(r#type.to_string())
                        .fetch_all(state.database.read())
                        .await
                        .unwrap();

                        data
                    },)
                );

                let mut requests = Requests {
                    root: TypeStats {
                        total: 0,
                        unique_ips: 0,
                    },
                    versions: IndexMap::new(),
                };

                for row in data.unwrap() {
                    let version = row.get::<String, _>("version");
                    if version == "/" {
                        requests.root = TypeStats {
                            total: row.get("total"),
                            unique_ips: row.get("unique_ips"),
                        };
                    } else {
                        let version = if !SERVER_TYPES_WITH_PROJECT_AS_IDENTIFIER.contains(&r#type)
                        {
                            minecraft_versions
                                .iter()
                                .find(|v| version == v.id.to_uppercase())
                                .map(|v| v.id.clone())
                        } else {
                            project_versions
                                .iter()
                                .find(|v| version == v.id.to_uppercase())
                                .map(|v| v.id.clone())
                        };

                        if let Some(version) = version {
                            requests.versions.insert(
                                version,
                                TypeStats {
                                    total: row.get("total"),
                                    unique_ips: row.get("unique_ips"),
                                },
                            );
                        }
                    }
                }

                requests
            })
            .await;

        axum::Json(
            serde_json::to_value(&Response {
                success: true,
                requests,
            })
            .unwrap(),
        )
    }
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .routes(routes!(get::route))
        .nest("/history", history::router(state))
        .with_state(state.clone())
}
