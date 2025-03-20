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
        requests: IndexMap<String, Vec<VersionStats>>,
    }

    #[utoipa::path(get, path = "/{year}/{month}", responses(
        (status = OK, body = inline(Response)),
        (status = BAD_REQUEST, body = inline(ApiError)),
    ), params(
        (
            "version" = String,
            description = "The server version",
            example = "1.17.1",
        ),
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
        Path((version, year, month)): Path<(String, u16, u8)>,
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

        let requests = state
            .cache
            .cached(
                &format!(
                    "requests::versions::{}::history::{}::{}",
                    version, start, end
                ),
                10800,
                || async {
                    let data = sqlx::query(
                        r#"
                        SELECT
                            COUNT(*) AS total,
                            COUNT(DISTINCT x.ip) AS unique_ips,
                            EXTRACT(DAY FROM x.created)::smallint AS day,
                            x.type AS type
                        FROM (
                            SELECT
                                requests.ip AS ip,
                                requests.created AS created,
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
                                AND requests.created >= $2
                                AND requests.created <= $3
                        ) AS x
                        WHERE
                            EXISTS(
                                SELECT 1
                                FROM pg_enum
                                WHERE enumtypid = 'server_type'::regtype::oid
                                AND enumlabel = x.type
                            )
                        GROUP BY day, x.type
                        ORDER BY total DESC
                        "#,
                    )
                    .bind(version)
                    .bind(start)
                    .bind(end)
                    .fetch_all(state.database.read())
                    .await
                    .unwrap();

                    let mut requests = IndexMap::new();
                    for row in &data {
                        let r#type = row.get::<String, _>("type");
                        if !requests.contains_key(&r#type) {
                            let mut stats = Vec::with_capacity(end.day() as usize);

                            for i in 0..end.day() {
                                stats.push(VersionStats {
                                    day: i as i16 + 1,
                                    total: 0,
                                    unique_ips: 0,
                                });
                            }

                            requests.insert(r#type, stats);
                        }
                    }

                    for row in data {
                        let r#type = row.get::<String, _>("type");
                        let day = row.get::<i16, _>("day") as usize - 1;

                        let entry = requests.get_mut(&r#type).unwrap().get_mut(day).unwrap();
                        entry.total = row.get("total");
                        entry.unique_ips = row.get("unique_ips");
                    }

                    requests
                },
            )
            .await;

        (
            StatusCode::OK,
            axum::Json(
                serde_json::to_value(&Response {
                    success: true,
                    requests,
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
