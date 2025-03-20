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
        versions: IndexMap<String, VersionStats>,
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
        let versions = state
            .cache
            .cached(&format!("lookups::versions::{}", r#type), 10800, || async {
                let data = sqlx::query(&format!(
                    r#"
                    SELECT
                        x.version AS version,
                        COUNT(*) AS total,
                        COUNT(DISTINCT ip) AS unique_ips
                    FROM (
                        SELECT
                            requests.data->'build'->>'{}' AS version,
                            requests.ip AS ip
                        FROM requests
                        WHERE
                            requests.status = 200
                            AND requests.data IS NOT NULL
                            AND requests.path NOT LIKE '%tracking=nostats%'
                            AND requests.data->>'type' = 'lookup'
                            AND requests.data->'build'->>'type' = $1
                    ) AS x
                    WHERE x.version IS NOT NULL
                    GROUP BY x.version
                    ORDER BY total DESC
                    "#,
                    if SERVER_TYPES_WITH_PROJECT_AS_IDENTIFIER.contains(&r#type) {
                        "projectVersionId"
                    } else {
                        "versionId"
                    }
                ))
                .bind(r#type.to_string())
                .fetch_all(state.database.read())
                .await
                .unwrap();

                let mut versions = IndexMap::new();

                for row in data {
                    versions.insert(
                        row.get("version"),
                        VersionStats {
                            total: row.get("total"),
                            unique_ips: row.get("unique_ips"),
                        },
                    );
                }

                versions
            })
            .await;

        axum::Json(
            serde_json::to_value(&Response {
                success: true,
                versions,
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
