use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::session_store::{now_millis, validate_id, SessionStore};

const NAME_MAX: usize = 64;
const DESCRIPTION_MAX: usize = 200;
const BODY_MAX: usize = 100_000;

/// A prompt the user keeps for one project. Plain text: it is inserted into the
/// composer, so nothing here may depend on the harness that happens to be bound.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTemplate {
    pub id: String,
    pub project_key: String,
    pub project_path: String,
    pub name: String,
    pub description: String,
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTemplateUpsert {
    pub id: String,
    pub project_key: String,
    pub project_path: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub body: String,
}

pub fn ensure_prompt_templates_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS prompt_templates (
           id TEXT PRIMARY KEY,
           project_key TEXT NOT NULL,
           project_path TEXT NOT NULL,
           name TEXT NOT NULL,
           description TEXT NOT NULL DEFAULT '',
           body TEXT NOT NULL DEFAULT '',
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE UNIQUE INDEX IF NOT EXISTS prompt_templates_name_idx
           ON prompt_templates (project_key, name);",
    )
}

#[tauri::command(async)]
pub fn prompt_templates_list(
    store: State<'_, SessionStore>,
    project_key: String,
) -> Result<Vec<PromptTemplate>, String> {
    let key = project_key.trim();
    if key.is_empty() {
        return Ok(Vec::new());
    }
    let conn = store.lock_conn()?;
    list_templates(&conn, key).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn prompt_templates_upsert(
    store: State<'_, SessionStore>,
    template: PromptTemplateUpsert,
) -> Result<PromptTemplate, String> {
    validate_id(&template.id, "prompt template")?;
    let name = normalize_name(&template.name)?;
    if template.project_key.trim().is_empty() || template.project_path.trim().is_empty() {
        return Err("Prompt templates need an open project".into());
    }
    if template.body.len() > BODY_MAX {
        return Err("Template is too large".into());
    }
    let conn = store.lock_conn()?;
    upsert_template(&conn, &template, &name)
}

#[tauri::command(async)]
pub fn prompt_templates_delete(store: State<'_, SessionStore>, id: String) -> Result<(), String> {
    validate_id(&id, "prompt template")?;
    let conn = store.lock_conn()?;
    conn.execute("DELETE FROM prompt_templates WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Drops every template of one project, for "remove project data".
#[tauri::command(async)]
pub fn prompt_templates_delete_project(
    store: State<'_, SessionStore>,
    project_key: String,
) -> Result<(), String> {
    let key = project_key.trim();
    if key.is_empty() {
        return Ok(());
    }
    let conn = store.lock_conn()?;
    conn.execute(
        "DELETE FROM prompt_templates WHERE project_key = ?1",
        params![key],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn list_templates(conn: &Connection, project_key: &str) -> rusqlite::Result<Vec<PromptTemplate>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_key, project_path, name, description, body,
                created_at, updated_at
         FROM prompt_templates
         WHERE project_key = ?1
         ORDER BY name ASC",
    )?;
    let rows = stmt.query_map(params![project_key], read_template)?;
    rows.collect()
}

fn upsert_template(
    conn: &Connection,
    template: &PromptTemplateUpsert,
    name: &str,
) -> Result<PromptTemplate, String> {
    let project_key = template.project_key.trim();
    let project_path = template.project_path.trim();
    let description = truncate(template.description.trim(), DESCRIPTION_MAX);
    let body = template.body.replace("\r\n", "\n").replace('\r', "\n");
    let now = now_millis();

    let taken: Option<String> = conn
        .query_row(
            "SELECT id FROM prompt_templates WHERE project_key = ?1 AND name = ?2",
            params![project_key, name],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if taken.is_some_and(|id| id != template.id) {
        return Err(format!("A template named \"{name}\" already exists here"));
    }

    let created_at: Option<i64> = conn
        .query_row(
            "SELECT created_at FROM prompt_templates WHERE id = ?1",
            params![template.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    match created_at {
        Some(created_at) => {
            conn.execute(
                "UPDATE prompt_templates
                 SET project_key = ?1, project_path = ?2, name = ?3,
                     description = ?4, body = ?5, updated_at = ?6
                 WHERE id = ?7",
                params![
                    project_key,
                    project_path,
                    name,
                    description,
                    body,
                    now,
                    template.id
                ],
            )
            .map_err(|e| e.to_string())?;
            Ok(PromptTemplate {
                id: template.id.clone(),
                project_key: project_key.to_string(),
                project_path: project_path.to_string(),
                name: name.to_string(),
                description,
                body,
                created_at,
                updated_at: now,
            })
        }
        None => {
            conn.execute(
                "INSERT INTO prompt_templates (
                   id, project_key, project_path, name, description, body,
                   created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    template.id,
                    project_key,
                    project_path,
                    name,
                    description,
                    body,
                    now,
                    now
                ],
            )
            .map_err(|e| e.to_string())?;
            Ok(PromptTemplate {
                id: template.id.clone(),
                project_key: project_key.to_string(),
                project_path: project_path.to_string(),
                name: name.to_string(),
                description,
                body,
                created_at: now,
                updated_at: now,
            })
        }
    }
}

fn read_template(row: &rusqlite::Row<'_>) -> rusqlite::Result<PromptTemplate> {
    Ok(PromptTemplate {
        id: row.get(0)?,
        project_key: row.get(1)?,
        project_path: row.get(2)?,
        name: row.get(3)?,
        description: row.get(4)?,
        body: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

/// The name has to survive being typed back as a `/slash` token, so it keeps the
/// same shape a skill name does.
fn normalize_name(raw: &str) -> Result<String, String> {
    let name = raw.trim().to_ascii_lowercase();
    let valid = !name.is_empty()
        && name.len() <= NAME_MAX
        && !name.starts_with('-')
        && !name.ends_with('-')
        && !name.contains("--")
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    if !valid {
        return Err("Use a lowercase name with letters, numbers, and hyphens.".into());
    }
    Ok(name)
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    value.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        ensure_prompt_templates_table(&conn).expect("schema");
        conn
    }

    fn upsert(id: &str, project: &str, name: &str) -> PromptTemplateUpsert {
        PromptTemplateUpsert {
            id: id.into(),
            project_key: project.into(),
            project_path: project.into(),
            name: name.into(),
            description: String::new(),
            body: "Review @src/lib\r\nagainst our conventions".into(),
        }
    }

    #[test]
    fn lists_only_the_project_it_was_created_in() {
        let conn = conn();
        upsert_template(&conn, &upsert("a", "/repo/one", "review"), "review").expect("insert");
        upsert_template(&conn, &upsert("b", "/repo/two", "review"), "review").expect("insert");

        let one = list_templates(&conn, "/repo/one").expect("list");
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].id, "a");
        assert_eq!(one[0].body, "Review @src/lib\nagainst our conventions");
    }

    #[test]
    fn updating_keeps_the_created_timestamp_and_replaces_the_body() {
        let conn = conn();
        let first = upsert_template(&conn, &upsert("a", "/repo", "review"), "review").expect("new");
        let mut edit = upsert("a", "/repo", "review-diff");
        edit.body = "changed".into();
        let second = upsert_template(&conn, &edit, "review-diff").expect("edit");

        assert_eq!(second.created_at, first.created_at);
        assert_eq!(second.name, "review-diff");
        assert_eq!(second.body, "changed");
        assert_eq!(list_templates(&conn, "/repo").expect("list").len(), 1);
    }

    #[test]
    fn rejects_a_duplicate_name_inside_one_project() {
        let conn = conn();
        upsert_template(&conn, &upsert("a", "/repo", "review"), "review").expect("insert");
        let clash = upsert_template(&conn, &upsert("b", "/repo", "review"), "review");
        assert!(clash.is_err());
    }

    #[test]
    fn deleting_a_project_leaves_other_projects_alone() {
        let conn = conn();
        upsert_template(&conn, &upsert("a", "/repo", "review"), "review").expect("insert");
        upsert_template(&conn, &upsert("b", "/repo/../other", "review"), "review").expect("insert");

        conn.execute(
            "DELETE FROM prompt_templates WHERE project_key = ?1",
            params!["/repo"],
        )
        .expect("delete");

        assert!(list_templates(&conn, "/repo").expect("list").is_empty());
        assert_eq!(
            list_templates(&conn, "/repo/../other").expect("list").len(),
            1
        );
    }

    #[test]
    fn normalizes_and_rejects_unusable_names() {
        assert_eq!(normalize_name("  Review-Diff "), Ok("review-diff".into()));
        assert!(normalize_name("review diff").is_err());
        assert!(normalize_name("-review").is_err());
        assert!(normalize_name("").is_err());
    }
}
