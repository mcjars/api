use crate::models::BaseModel;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use sqlx::{Row, postgres::PgRow, types::chrono::NaiveDateTime};
use std::collections::BTreeMap;
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Clone)]
pub struct User {
    pub id: i32,
    pub github_id: i32,

    pub admin: bool,

    pub name: Option<String>,
    pub email: String,
    pub login: String,

    pub last_login: NaiveDateTime,
    pub created: NaiveDateTime,
}

impl BaseModel for User {
    fn columns(prefix: Option<&str>, table: Option<&str>) -> BTreeMap<String, String> {
        let table = table.unwrap_or("users");

        BTreeMap::from([
            (
                format!("{}.id", table),
                format!("{}id", prefix.unwrap_or_default()),
            ),
            (
                format!("{}.github_id", table),
                format!("{}github_id", prefix.unwrap_or_default()),
            ),
            (
                format!("{}.admin", table),
                format!("{}admin", prefix.unwrap_or_default()),
            ),
            (
                format!("{}.name", table),
                format!("{}name", prefix.unwrap_or_default()),
            ),
            (
                format!("{}.email", table),
                format!("{}email", prefix.unwrap_or_default()),
            ),
            (
                format!("{}.login", table),
                format!("{}login", prefix.unwrap_or_default()),
            ),
            (
                format!("{}.last_login", table),
                format!("{}last_login", prefix.unwrap_or_default()),
            ),
            (
                format!("{}.created", table),
                format!("{}created", prefix.unwrap_or_default()),
            ),
        ])
    }

    fn map(prefix: Option<&str>, row: &PgRow) -> Self {
        let prefix = prefix.unwrap_or_default();

        Self {
            id: row.get(format!("{}id", prefix).as_str()),
            github_id: row.get(format!("{}github_id", prefix).as_str()),
            admin: row.get(format!("{}admin", prefix).as_str()),
            name: row.get(format!("{}name", prefix).as_str()),
            email: row.get(format!("{}email", prefix).as_str()),
            login: row.get(format!("{}login", prefix).as_str()),
            last_login: row.get(format!("{}last_login", prefix).as_str()),
            created: row.get(format!("{}created", prefix).as_str()),
        }
    }
}

impl User {
    pub async fn new(
        database: &crate::database::Database,
        github_id: i32,
        name: Option<String>,
        email: String,
        login: String,
    ) -> Self {
        let row = sqlx::query(&format!(
            r#"
            INSERT INTO users (github_id, name, email, login, last_login, created)
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            ON CONFLICT (github_id) DO UPDATE SET 
                name = EXCLUDED.name,
                email = EXCLUDED.email,
                login = EXCLUDED.login,
                last_login = NOW()
            RETURNING {}
            "#,
            Self::columns_sql(None, None)
        ))
        .bind(github_id)
        .bind(&name)
        .bind(&email)
        .bind(&login)
        .fetch_one(database.write())
        .await
        .unwrap();

        Self::map(None, &row)
    }

    pub async fn by_session(
        database: &crate::database::Database,
        session: &str,
    ) -> Option<(Self, UserSession)> {
        let row = sqlx::query(&format!(
            r#"
            SELECT {}, {}
            FROM users
            JOIN user_sessions ON user_sessions.user_id = users.id
            WHERE user_sessions.session = $1
            "#,
            Self::columns_sql(None, None),
            UserSession::columns_sql(Some("session_"), None)
        ))
        .bind(session)
        .fetch_optional(database.read())
        .await
        .unwrap();

        row.map(|row| {
            (
                Self::map(None, &row),
                UserSession::map(Some("session_"), &row),
            )
        })
    }

    pub async fn by_login(
        database: &crate::database::Database,
        cache: &crate::cache::Cache,
        login: &str,
    ) -> Option<Self> {
        cache
            .cached(&format!("user::{}", login), 3600, || async {
                let row = sqlx::query(&format!(
                    r#"
                    SELECT {}
                    FROM users
                    WHERE users.login ILIKE $1
                    "#,
                    Self::columns_sql(None, None)
                ))
                .bind(login.replace('%', "\\%").replace('_', "\\_"))
                .fetch_optional(database.read())
                .await
                .unwrap();

                row.map(|row| Self::map(None, &row))
            })
            .await
    }

    pub fn api_user(&self, hide_email: bool) -> ApiUser {
        ApiUser {
            id: self.id,
            github_id: self.github_id,
            admin: self.admin,
            name: self.name.clone(),
            avatar: format!("https://avatars.githubusercontent.com/u/{}", self.github_id),
            email: if hide_email {
                "hidden@email.com".to_string()
            } else {
                self.email.clone()
            },
            login: self.login.clone(),
        }
    }
}

#[derive(ToSchema, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[schema(rename_all = "camelCase", title = "User")]
pub struct ApiUser {
    pub id: i32,
    pub github_id: i32,
    pub admin: bool,
    pub name: Option<String>,
    pub avatar: String,
    pub email: String,
    pub login: String,
}

#[derive(ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[schema(rename_all = "camelCase")]
pub struct UserSession {
    pub id: i32,

    #[schema(value_type = String)]
    pub ip: sqlx::types::ipnetwork::IpNetwork,
    pub user_agent: String,

    pub last_used: NaiveDateTime,
    pub created: NaiveDateTime,
}

impl BaseModel for UserSession {
    fn columns(prefix: Option<&str>, table: Option<&str>) -> BTreeMap<String, String> {
        let table = table.unwrap_or("user_sessions");

        BTreeMap::from([
            (
                format!("{}.id", table),
                format!("{}id", prefix.unwrap_or_default()),
            ),
            (
                format!("{}.ip", table),
                format!("{}ip", prefix.unwrap_or_default()),
            ),
            (
                format!("{}.user_agent", table),
                format!("{}user_agent", prefix.unwrap_or_default()),
            ),
            (
                format!("{}.last_used", table),
                format!("{}last_used", prefix.unwrap_or_default()),
            ),
            (
                format!("{}.created", table),
                format!("{}created", prefix.unwrap_or_default()),
            ),
        ])
    }

    fn map(prefix: Option<&str>, row: &PgRow) -> Self {
        let prefix = prefix.unwrap_or_default();

        Self {
            id: row.get(format!("{}id", prefix).as_str()),
            ip: row.get(format!("{}ip", prefix).as_str()),
            user_agent: row.get(format!("{}user_agent", prefix).as_str()),
            last_used: row.get(format!("{}last_used", prefix).as_str()),
            created: row.get(format!("{}created", prefix).as_str()),
        }
    }
}

impl UserSession {
    pub async fn new(
        database: &crate::database::Database,
        user_id: i32,
        ip: sqlx::types::ipnetwork::IpNetwork,
        user_agent: &str,
    ) -> (Self, String) {
        let mut hash = sha2::Sha256::new();
        hash.update(chrono::Utc::now().timestamp().to_be_bytes());
        hash.update(user_id.to_be_bytes());
        let hash = format!("{:x}", hash.finalize());

        let row = sqlx::query(&format!(
            r#"
            INSERT INTO user_sessions (user_id, session, ip, user_agent, last_used, created)
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            RETURNING {}
            "#,
            Self::columns_sql(None, None)
        ))
        .bind(user_id)
        .bind(&hash)
        .bind(ip)
        .bind(user_agent)
        .fetch_one(database.write())
        .await
        .unwrap();

        (Self::map(None, &row), hash)
    }

    pub async fn save(&self, database: &crate::database::Database) {
        sqlx::query(
            r#"
            UPDATE user_sessions
            SET
                ip = $2,
                user_agent = $3,
                last_used = $4
            WHERE user_sessions.id = $1
            "#,
        )
        .bind(self.id)
        .bind(self.ip)
        .bind(&self.user_agent)
        .bind(self.last_used)
        .execute(database.write())
        .await
        .unwrap();
    }

    pub async fn delete_by_session(database: &crate::database::Database, session: &str) {
        sqlx::query(
            r#"
            DELETE FROM user_sessions
            WHERE user_sessions.session = $1
            "#,
        )
        .bind(session)
        .execute(database.write())
        .await
        .unwrap();
    }
}
