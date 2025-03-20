use super::State;
use utoipa_axum::{router::OpenApiRouter, routes};

mod history;

mod get {
    use crate::routes::GetState;
    use axum::extract::Path;
    use indexmap::IndexMap;
    use serde::{Deserialize, Serialize};
    use sqlx::Row;
    use utoipa::ToSchema;

    #[derive(ToSchema, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct VersionStats {
        total: i64,
        unique_ips: i64,
    }

    #[derive(ToSchema, Serialize, Deserialize)]
    struct Response {
        success: bool,

        #[schema(inline)]
        requests: IndexMap<String, VersionStats>,
    }

    #[utoipa::path(get, path = "/", responses(
        (status = OK, body = inline(Response)),
    ), params(
        (
            "version" = String,
            description = "The server version",
            example = "1.17.1",
        ),
    ))]
    pub async fn route(
        state: GetState,
        Path(version): Path<String>,
    ) -> axum::Json<serde_json::Value> {
        let requests = state
            .cache
            .cached(
                &format!("requests::versions::{}", version),
                10800,
                || async {
                    let data = sqlx::query(
                        r#"
                        SELECT
                            COUNT(*) AS total,
                            COUNT(DISTINCT ip) AS unique_ips,
                            x.type AS type
                        FROM (
                            SELECT
                                requests.ip AS ip,
                                UPPER(
                                    SPLIT_PART(
                                        SPLIT_PART(
                                            SUBSTR(requests.path, 16),
                                            '?',
                                            1
                                        ),
                                        '/',
                                        1
                                    )
                                ) AS type
                            FROM requests
                            WHERE
                                requests.status = 200
                                AND requests.path NOT LIKE '%tracking=nostats%'
                                AND requests.path LIKE '/api/v_/builds/%'
                                AND requests.path LIKE '%/' || $1 || '%'
                        ) AS x
                        WHERE
                            EXISTS(
                                SELECT 1
                                FROM pg_enum
                                WHERE enumtypid = 'server_type'::regtype::oid
                                AND enumlabel = x.type
                            )
                        GROUP BY x.type
                        ORDER BY total DESC
                        "#,
                    )
                    .bind(version)
                    .fetch_all(state.database.read())
                    .await
                    .unwrap();

                    let mut requests = IndexMap::new();

                    for row in data {
                        requests.insert(
                            row.get("type"),
                            VersionStats {
                                total: row.get("total"),
                                unique_ips: row.get("unique_ips"),
                            },
                        );
                    }

                    requests
                },
            )
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
