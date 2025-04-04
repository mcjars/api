use super::{ApiError, GetState, State};
use utoipa_axum::router::OpenApiRouter;

mod github;
mod organization;
mod user;
mod v1;
mod v2;

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .nest("/v1", v1::router(state))
        .nest("/v2", v2::router(state))
        .nest("/organization", organization::router(state))
        .nest("/github", github::router(state))
        .nest("/user", user::router(state))
        .with_state(state.clone())
}
