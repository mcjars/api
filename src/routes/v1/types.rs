use super::State;
use utoipa_axum::{router::OpenApiRouter, routes};

mod get {
    use crate::{
        models::r#type::{ESTABLISHED_TYPES, ServerType, ServerTypeInfo},
        routes::{ApiError, GetState},
    };
    use indexmap::IndexMap;
    use serde::{Deserialize, Serialize};
    use utoipa::ToSchema;

    #[derive(ToSchema, Serialize, Deserialize)]
    struct Response {
        success: bool,
        types: IndexMap<ServerType, ServerTypeInfo>,
    }

    #[utoipa::path(get, path = "/", responses(
        (status = OK, body = inline(Response)),
        (status = NOT_FOUND, body = inline(ApiError)),
    ))]
    pub async fn route(state: GetState) -> axum::Json<serde_json::Value> {
        let data = ServerType::all(&state.database, &state.cache).await;

        axum::Json(
            serde_json::to_value(&Response {
                success: true,
                types: ServerType::extract(&data, &ESTABLISHED_TYPES),
            })
            .unwrap(),
        )
    }
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .routes(routes!(get::route))
        .with_state(state.clone())
}
