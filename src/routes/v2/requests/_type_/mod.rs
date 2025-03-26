use super::State;
use utoipa_axum::{router::OpenApiRouter, routes};

mod history;

mod get {
    use crate::{models::r#type::ServerType, routes::GetState};
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
                let data = sqlx::query(
                    r#"
                    SELECT
                        x.version AS version,
                        COUNT(*) AS total,
                        COUNT(DISTINCT ip) AS unique_ips
                    FROM (
                        SELECT
                            requests.data->'search'->>'version' AS version,
                            requests.ip AS ip
                        FROM requests
                        WHERE
                            requests.status = 200
                            AND requests.data IS NOT NULL
                            AND requests.path NOT LIKE '%tracking=nostats%'
                            AND requests.data->>'type' = 'builds'
                            AND requests.data->'search'->>'type' = $1
                    ) AS x
                    GROUP BY x.version
                    ORDER BY total DESC
                    "#,
                )
                .bind(r#type.to_string())
                .fetch_all(state.database.read())
                .await
                .unwrap();

                let mut requests = Requests {
                    root: TypeStats {
                        total: 0,
                        unique_ips: 0,
                    },
                    versions: IndexMap::new(),
                };

                for row in data {
                    let version = row.get::<Option<String>, _>("version");

                    if let Some(version) = version {
                        requests.versions.insert(
                            version,
                            TypeStats {
                                total: row.get("total"),
                                unique_ips: row.get("unique_ips"),
                            },
                        );
                    } else {
                        requests.root = TypeStats {
                            total: row.get("total"),
                            unique_ips: row.get("unique_ips"),
                        };
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
