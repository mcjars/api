use crate::env::RedisMode;
use colored::Colorize;
use rustis::client::Client;
use rustis::commands::{SetCondition, SetExpiration, StringCommands};
use rustis::resp::cmd;
use serde::{Serialize, de::DeserializeOwned};
use std::future::Future;
use std::sync::Arc;

pub struct Cache {
    pub client: Client,
}

impl Cache {
    pub async fn new(env: Arc<crate::env::Env>) -> Self {
        let start = std::time::Instant::now();

        let instance = Self {
            client: match env.redis_mode {
                RedisMode::Redis => Client::connect(env.redis_url.as_ref().unwrap().clone())
                    .await
                    .unwrap(),
                RedisMode::Sentinel => Client::connect(
                    format!(
                        "redis-sentinel://{}/mymaster/0",
                        env.redis_sentinels.as_ref().unwrap().clone().join(",")
                    )
                    .as_str(),
                )
                .await
                .unwrap(),
            },
        };

        let version = String::from_utf8(
            instance
                .client
                .send(cmd("INFO"), None)
                .await
                .unwrap()
                .as_bytes()
                .into(),
        )
        .unwrap()
        .lines()
        .find(|line| line.starts_with("redis_version:"))
        .unwrap()
        .split(':')
        .collect::<Vec<&str>>()[1]
            .to_string();

        crate::logger::log(
            crate::logger::LoggerLevel::Info,
            format!(
                "{} connected {}",
                "cache".bright_yellow(),
                format!("(redis@{}, {}ms)", version, start.elapsed().as_millis()).bright_black()
            ),
        );

        instance
    }

    #[inline(always)]
    pub async fn cached<T, F, Fut>(&self, key: &str, ttl: u64, fn_compute: F) -> T
    where
        T: Serialize + DeserializeOwned,
        F: FnOnce() -> Fut,
        Fut: Future<Output = T>,
    {
        let cached_value: Option<String> = self.client.get(key).await.unwrap();

        match cached_value {
            Some(value) => {
                let result: T = serde_json::from_str(&value).unwrap();

                result
            }
            None => {
                let result = fn_compute().await;

                let serialized = serde_json::to_string(&result).unwrap();
                self.client
                    .set_with_options(
                        key,
                        serialized,
                        SetCondition::None,
                        SetExpiration::Ex(ttl),
                        false,
                    )
                    .await
                    .unwrap();

                result
            }
        }
    }
}
