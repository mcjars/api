use super::State;
use utoipa_axum::{router::OpenApiRouter, routes};

mod get {
    use crate::routes::{ApiError, GetState};
    use axum::{extract::Path, http::StatusCode};
    use chrono::Datelike;
    use indexmap::IndexMap;
    use serde::{Deserialize, Serialize};
    use sqlx::Row;
    use utoipa::ToSchema;

    #[derive(ToSchema, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct VersionStats {
        day: i16,
        total: i64,
        unique_ips: i64,
    }

    #[derive(ToSchema, Serialize, Deserialize)]
    struct Response {
        success: bool,

        #[schema(inline)]
        versions: IndexMap<String, Vec<VersionStats>>,
    }

    #[utoipa::path(get, path = "/{year}/{month}", responses(
        (status = OK, body = inline(Response)),
        (status = BAD_REQUEST, body = inline(ApiError)),
    ), params(
        (
            "year" = u16,
            description = "The year to get the version history for",
            minimum = 2024,
        ),
        (
            "month" = u8,
            description = "The month to get the version history for",
            minimum = 1,
            maximum = 12,
        ),
    ))]
    pub async fn route(
        state: GetState,
        Path((year, month)): Path<(u16, u8)>,
    ) -> (StatusCode, axum::Json<serde_json::Value>) {
        if year < 2024 || year > chrono::Utc::now().year() as u16 {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(ApiError::new(&["Invalid year"]).to_value()),
            );
        }

        if !(1..=12).contains(&month) {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(ApiError::new(&["Invalid month"]).to_value()),
            );
        }

        let start = chrono::NaiveDate::from_ymd_opt(year as i32, month as u32, 1).unwrap();
        let end = {
            let next_month = if month == 12 {
                chrono::NaiveDate::from_ymd_opt(year as i32 + 1, 1, 1).unwrap()
            } else {
                chrono::NaiveDate::from_ymd_opt(year as i32, month as u32 + 1, 1).unwrap()
            };

            next_month.pred_opt().unwrap()
        };

        let versions = state
            .cache
            .cached(
                &format!("lookups::versions::all::history::{}::{}", start, end),
                10800,
                || async {
                    let data = sqlx::query(
                        r#"
                        SELECT
                            x.version AS version,
                            EXTRACT(DAY FROM x.created)::smallint AS day,
                            COUNT(*) AS total,
                            COUNT(DISTINCT ip) AS unique_ips
                        FROM (
                            SELECT
                                requests.data->'build'->>'versionId' AS version,
                                requests.created AS created,
                                requests.ip AS ip
                            FROM requests
                            WHERE
                                requests.status = 200
                                AND requests.data IS NOT NULL
                                AND requests.path NOT LIKE '%tracking=nostats%'
                                AND requests.data->>'type' = 'lookup'
                                AND requests.created >= $1
                                AND requests.created <= $2
                        ) AS x
                        WHERE x.version IS NOT NULL
                        GROUP BY day, x.version
                        ORDER BY day, total DESC
                        "#,
                    )
                    .bind(start)
                    .bind(end)
                    .fetch_all(state.database.read())
                    .await
                    .unwrap();

                    let mut versions = IndexMap::new();
                    for row in &data {
                        let version = row.get::<String, _>("version");
                        if !versions.contains_key(&version) {
                            let mut stats = Vec::with_capacity(end.day() as usize);

                            for i in 0..end.day() {
                                stats.push(VersionStats {
                                    day: i as i16 + 1,
                                    total: 0,
                                    unique_ips: 0,
                                });
                            }

                            versions.insert(version, stats);
                        }
                    }

                    for row in data {
                        let version = row.get::<String, _>("version");
                        let day = row.get::<i16, _>("day") as usize - 1;

                        let entry = versions.get_mut(&version).unwrap().get_mut(day).unwrap();
                        entry.total = row.get("total");
                        entry.unique_ips = row.get("unique_ips");
                    }

                    versions
                },
            )
            .await;

        (
            StatusCode::OK,
            axum::Json(
                serde_json::to_value(&Response {
                    success: true,
                    versions,
                })
                .unwrap(),
            ),
        )
    }
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .routes(routes!(get::route))
        .with_state(state.clone())
}
