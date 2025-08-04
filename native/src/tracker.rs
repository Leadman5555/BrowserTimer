use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackingData {
    pub path: String,
    pub aggregate_time: u64,
    pub total_instances: usize,
    pub active_instances: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct TabInstance {
    tab_id: u32,
    time_active: u64,
    last_opened: Option<u64>,
}

impl TabInstance {
    pub fn new(tab_id: u32, timestamp: u64) -> Self {
        Self {
            tab_id,
            time_active: 0,
            last_opened: Some(timestamp),
        }
    }

    fn accumulate_time(&mut self, current_time: u64) {
        if let Some(last_opened) = self.last_opened.take() {
            let duration = current_time.saturating_sub(last_opened);
            self.time_active = self.time_active.saturating_add(duration);
        }
    }

    fn accumulate_and_reset(&mut self, relative_timestamp: u64) -> u64 {
        if let Some(last_opened) = self.last_opened {
            let duration = relative_timestamp.saturating_sub(last_opened);
            self.last_opened = Some(relative_timestamp);
            self.time_active = self.time_active.saturating_add(duration);
        }

        let total = self.time_active;
        self.time_active = 0;
        total
    }

    fn is_active(&self) -> bool {
        self.last_opened.is_some()
    }
}

#[derive(Debug, Clone)]
struct UrlNode {
    sub_part: String,
    aggregate_time: u64,
    instances: Vec<TabInstance>,
    children: HashMap<String, UrlNode>,
}

impl UrlNode {
    fn new(sub_part: String) -> Self {
        Self {
            sub_part,
            aggregate_time: 0,
            instances: Vec::new(),
            children: HashMap::new(),
        }
    }

    fn find_tab_instance(&mut self, tab_id: u32) -> Option<&mut TabInstance> {
        self.instances
            .iter_mut()
            .find(|instance| instance.tab_id == tab_id)
    }

    fn remove_tab_instance(&mut self, tab_id: u32) -> Option<TabInstance> {
        if let Some(pos) = self
            .instances
            .iter()
            .position(|instance| instance.tab_id == tab_id)
        {
            Some(self.instances.swap_remove(pos))
        } else {
            None
        }
    }

    fn add_tab_instance(&mut self, tab_id: u32, timestamp: u64) {
        if let Some(existing) = self.find_tab_instance(tab_id) {
            if existing.last_opened.is_none() {
                existing.last_opened = Some(timestamp);
            }
        } else {
            self.instances.push(TabInstance::new(tab_id, timestamp));
        }
    }

    fn accumulate_all_instances(&mut self, current_time: u64) -> (u64, usize, usize) {
        let mut total_time = 0u64;
        let mut active_count = 0usize;

        for instance in &mut self.instances {
            if instance.is_active() {
                active_count += 1;
            }
            total_time = total_time.saturating_add(instance.accumulate_and_reset(current_time));
        }

        self.aggregate_time = self.aggregate_time.saturating_add(total_time);
        (self.aggregate_time, active_count, self.instances.len())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct SerializedSession {
    pub session_name: String,
    pub data: HashMap<String, SerializedUrlNode>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct SerializedUrlNode {
    pub(crate) sub_part: String,
    pub(crate) aggregate_time: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) instances: Option<Vec<TabInstance>>,
    pub(crate) children: HashMap<String, SerializedUrlNode>,
}

impl From<&mut UrlNode> for SerializedUrlNode {
    fn from(node: &mut UrlNode) -> Self {
        let mut children = HashMap::with_capacity(node.children.len());
        for (key, child) in &mut node.children {
            children.insert(key.clone(), SerializedUrlNode::from(child));
        }
        Self {
            sub_part: node.sub_part.clone(),
            aggregate_time: node.aggregate_time,
            instances: Some(node.instances.clone()),
            children,
        }
    }
}

impl SerializedUrlNode {
    fn without_instances(node: &mut UrlNode) -> Self {
        let children = node
            .children
            .iter_mut()
            .map(|(key, child)| (key.clone(), Self::without_instances(child)))
            .collect();

        Self {
            sub_part: node.sub_part.clone(),
            aggregate_time: node.aggregate_time,
            instances: None,
            children,
        }
    }

    fn into_url_node(self, fresh_session: bool) -> UrlNode {
        let children = self
            .children
            .into_iter()
            .map(|(key, child)| (key, child.into_url_node(fresh_session)))
            .collect();

        UrlNode {
            sub_part: self.sub_part,
            aggregate_time: self.aggregate_time,
            instances: if fresh_session {
                Vec::new()
            } else {
                self.instances.unwrap_or_default()
            },
            children,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum TrackerError {
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
    #[error("Tab {0} not found")]
    TabNotFound(u32),
    #[error("URL parsing error: {0}")]
    UrlParseError(#[from] url::ParseError),
}

type Result<T> = std::result::Result<T, TrackerError>;

pub(crate) struct Tracker {
    root: HashMap<String, UrlNode>,
    session_name: String,
}

impl Tracker {
    pub fn new(session_name: String) -> Self {
        Self {
            root: HashMap::new(),
            session_name,
        }
    }

    pub fn from_serialized(
        session_name: String,
        data: HashMap<String, SerializedUrlNode>,
        fresh_session: bool,
    ) -> Self {
        let root = data
            .into_iter()
            .map(|(key, node)| (key, node.into_url_node(fresh_session)))
            .collect();

        Self { root, session_name }
    }

    fn current_timestamp() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(1754316069547) // 2025.08.04 because why not?
    }

    fn parse_url_parts(url: &str) -> Result<Vec<String>> {
        if url.is_empty() {
            return Err(TrackerError::InvalidUrl("Empty URL".to_string()));
        }

        let parsed = Url::parse(url)?;
        let mut parts = Vec::new();

        if let Some(host) = parsed.host_str() {
            parts.push(host.to_string());
        }

        if let Some(segments) = parsed.path_segments() {
            parts.extend(
                segments
                    .filter(|segment| segment.len() > 1)
                    .map(ToString::to_string),
            );
        }

        if parts.is_empty() {
            return Err(TrackerError::InvalidUrl(format!(
                "No parseable parts in URL: {}",
                url
            )));
        }

        Ok(parts)
    }

    fn find_or_create_node(&mut self, url_parts: &[String]) -> &mut UrlNode {
        let mut current_map = &mut self.root;

        for (i, part) in url_parts.iter().enumerate() {
            let entry = current_map
                .entry(part.clone())
                .or_insert_with(|| UrlNode::new(part.clone()));

            if i == url_parts.len() - 1 {
                return entry;
            }

            current_map = &mut entry.children;
        }

        unreachable!("Empty url_parts should be handled earlier")
    }

    fn find_node(&mut self, url_parts: &[String]) -> Option<&mut UrlNode> {
        let mut current = &mut self.root;

        for (i, part) in url_parts.iter().enumerate() {
            match current.get_mut(part) {
                Some(node) => {
                    if i == url_parts.len() - 1 {
                        return Some(node);
                    }
                    current = &mut node.children;
                }
                None => return None,
            }
        }

        None
    }

    pub fn track_tab_focused(&mut self, url: &str, tab_id: u32) -> Result<()> {
        let url_parts = Self::parse_url_parts(url)?;
        let timestamp = Self::current_timestamp();

        let node = self.find_or_create_node(&url_parts);
        node.add_tab_instance(tab_id, timestamp);
        Ok(())
    }

    pub fn track_tab_unfocused(&mut self, url: &str, tab_id: u32) -> Result<()> {
        let url_parts = Self::parse_url_parts(url)?;
        let timestamp = Self::current_timestamp();

        let node = self
            .find_node(&url_parts)
            .ok_or_else(|| TrackerError::TabNotFound(tab_id))?;

        let instance = node
            .find_tab_instance(tab_id)
            .ok_or_else(|| TrackerError::TabNotFound(tab_id))?;

        instance.accumulate_time(timestamp);
        Ok(())
    }

    pub fn track_tab_closed(&mut self, url: &str, tab_id: u32) -> Result<()> {
        let url_parts = Self::parse_url_parts(url)?;
        let timestamp = Self::current_timestamp();

        let node = self
            .find_node(&url_parts)
            .ok_or_else(|| TrackerError::TabNotFound(tab_id))?;

        let mut instance = node
            .remove_tab_instance(tab_id)
            .ok_or_else(|| TrackerError::TabNotFound(tab_id))?;

        instance.accumulate_time(timestamp);
        node.aggregate_time = node.aggregate_time.saturating_add(instance.time_active);
        Ok(())
    }

    fn collect_tracking_data(&mut self, current_time: u64) -> Vec<TrackingData> {
        let mut result = Vec::new();
        let mut path_buffer = String::with_capacity(256); // Pre-allocate reasonable size
        Tracker::collect_recursive(&mut result, current_time, &mut path_buffer, &mut self.root);
        result
    }

    fn collect_recursive(
        result: &mut Vec<TrackingData>,
        current_time: u64,
        path_buffer: &mut String,
        nodes: &mut HashMap<String, UrlNode>,
    ) {
        for (key, node) in nodes.iter_mut() {
            let original_len = path_buffer.len();
            if !path_buffer.is_empty() {
                path_buffer.push('/');
            }
            path_buffer.push_str(key);

            let (aggregate_time, active_instances, total_instances) =
                node.accumulate_all_instances(current_time);

            if aggregate_time > 0 {
                result.push(TrackingData {
                    path: path_buffer.clone(),
                    aggregate_time,
                    total_instances,
                    active_instances,
                });
            }
            Tracker::collect_recursive(result, current_time, path_buffer, &mut node.children);
            path_buffer.truncate(original_len);
        }
    }

    pub fn get_tracking_data(&mut self) -> Vec<TrackingData> {
        let current_time = Self::current_timestamp();
        let result = self.collect_tracking_data(current_time);
        result
    }

    pub fn serialize_session(&mut self, include_tabs: bool) -> SerializedSession {
        let current_time = Self::current_timestamp();
        let data = if include_tabs {
            self.serialize_with_tabs(current_time)
        } else {
            self.serialize_without_tabs(current_time)
        };

        SerializedSession {
            session_name: self.session_name.clone(),
            data,
        }
    }

    fn serialize_with_tabs(&mut self, current_time: u64) -> HashMap<String, SerializedUrlNode> {
        let mut result = HashMap::with_capacity(self.root.len());
        for (key, node) in &mut self.root {
            Self::update_node_times(node, current_time);
            result.insert(key.clone(), SerializedUrlNode::from(node));
        }
        result
    }

    fn serialize_without_tabs(&mut self, current_time: u64) -> HashMap<String, SerializedUrlNode> {
        self.root
            .iter_mut()
            .map(|(key, node)| {
                Self::update_node_times(node, current_time);
                (key.clone(), SerializedUrlNode::without_instances(node))
            })
            .collect()
    }

    fn update_node_times(node: &mut UrlNode, current_time: u64) {
        node.accumulate_all_instances(current_time);

        for child in node.children.values_mut() {
            Self::update_node_times(child, current_time);
        }
    }

    pub fn get_session_name(&self) -> &str {
        &self.session_name
    }
}

impl Default for Tracker {
    fn default() -> Self {
        Self::new("default".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;
    use std::time::Duration;
    #[test]
    fn test_new_tracker_creation() {
        let tracker = Tracker::new("test_session".to_string());
        assert_eq!(tracker.get_session_name(), "test_session");
        assert!(tracker.root.is_empty());
    }

    #[test]
    fn test_url_tree_creation() {
        let mut tracker = Tracker::new("test".to_string());
        tracker
            .track_tab_focused("https://example.com/path/to/page", 1)
            .unwrap();

        assert!(tracker.root.contains_key("example.com"));
        let root_node = tracker.root.get("example.com").unwrap();

        assert!(root_node.children.contains_key("path"));
        let path_node = root_node.children.get("path").unwrap();

        assert!(path_node.children.contains_key("to"));
        let to_node = path_node.children.get("to").unwrap();

        assert!(to_node.children.contains_key("page"));
        let page_node = to_node.children.get("page").unwrap();

        assert_eq!(page_node.instances.len(), 1);
        assert_eq!(page_node.instances[0].tab_id, 1);
    }

    #[test]
    fn test_multiple_tabs_same_url() {
        let mut tracker = Tracker::new("test".to_string());

        tracker.track_tab_focused("https://example.com", 1).unwrap();
        tracker.track_tab_focused("https://example.com", 2).unwrap();
        tracker.track_tab_focused("https://example.com", 3).unwrap();

        let node = tracker.root.get("example.com").unwrap();
        assert_eq!(node.instances.len(), 3);

        let tab_ids: Vec<u32> = node.instances.iter().map(|inst| inst.tab_id).collect();
        assert!(tab_ids.contains(&1));
        assert!(tab_ids.contains(&2));
        assert!(tab_ids.contains(&3));
    }

    #[test]
    fn test_tab_focusing_and_unfocusing() {
        let mut tracker = Tracker::new("test".to_string());
        tracker.track_tab_focused("https://example.com", 1).unwrap();

        let node = tracker.root.get("example.com").unwrap();
        assert!(node.instances[0].is_active());
        assert_eq!(node.instances[0].time_active, 0);

        tracker
            .track_tab_unfocused("https://example.com", 1)
            .unwrap();

        let node = tracker.root.get("example.com").unwrap();
        assert!(!node.instances[0].is_active());
    }

    #[test]
    fn test_tab_closing() {
        let mut tracker = Tracker::new("test".to_string());

        tracker.track_tab_focused("https://example.com", 1).unwrap();
        tracker.track_tab_closed("https://example.com", 1).unwrap();

        let node = tracker.root.get("example.com").unwrap();
        assert_eq!(node.instances.len(), 0);
    }

    #[test]
    fn test_tab_handling() {
        let mut tracker = Tracker::new("test".to_string());
        tracker.track_tab_focused("https://example.com", 1).unwrap();
        tracker.track_tab_closed("https://example.com", 1).unwrap();

        tracker.track_tab_focused("https://example.com", 2).unwrap();
        tracker
            .track_tab_unfocused("https://example.com", 2)
            .unwrap();

        let node = tracker.root.get("example.com").unwrap();
        assert_eq!(node.instances.len(), 1);
        assert!(!node.instances[0].is_active());
    }

    #[test]
    fn test_error_handling_unfocus_nonexistent_tab() {
        let mut tracker = Tracker::new("test".to_string());
        let result = tracker.track_tab_unfocused("https://example.com", 999);
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            TrackerError::TabNotFound(999)
        ));
    }

    #[test]
    fn test_error_handling_close_nonexistent_tab() {
        let mut tracker = Tracker::new("test".to_string());
        let result = tracker.track_tab_closed("https://example.com", 999);
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            TrackerError::TabNotFound(999)
        ));
    }

    #[test]
    fn test_error_handling_invalid_urls() {
        let mut tracker = Tracker::new("test".to_string());
        assert!(tracker.track_tab_focused("", 1).is_err());
        assert!(tracker.track_tab_focused("not-a-url", 1).is_err());
    }

    #[test]
    fn test_refocusing_existing_tab() {
        let mut tracker = Tracker::new("test".to_string());
        tracker.track_tab_focused("https://example.com", 1).unwrap();
        tracker
            .track_tab_unfocused("https://example.com", 1)
            .unwrap();
        tracker.track_tab_focused("https://example.com", 1).unwrap();

        let node = tracker.root.get("example.com").unwrap();
        assert_eq!(node.instances.len(), 1);
        assert!(node.instances[0].is_active());
    }

    #[test]
    fn test_tracking_data_collection() {
        let mut tracker = Tracker::new("test".to_string());

        tracker
            .track_tab_focused("https://example.com/path1", 1)
            .unwrap();
        tracker
            .track_tab_focused("https://example.com/path2", 2)
            .unwrap();
        sleep(Duration::from_millis(100));
        tracker
            .track_tab_closed("https://example.com/path1", 1)
            .unwrap();
        let tracking_data = tracker.get_tracking_data();

        assert!(!tracking_data.is_empty());

        let path1_data = tracking_data
            .iter()
            .find(|data| data.path == "example.com/path1")
            .expect("Should find path1 data");

        assert_eq!(path1_data.total_instances, 0);
        assert_eq!(path1_data.active_instances, 0);
        assert!(path1_data.aggregate_time > 0);

        let path2_data = tracking_data
            .iter()
            .find(|data| data.path == "example.com/path2")
            .expect("Should find path2 data");

        assert_eq!(path2_data.total_instances, 1);
        assert_eq!(path2_data.active_instances, 1);
    }

    #[test]
    fn test_from_serialized_fresh_session() {
        let mut original_tracker = Tracker::new("original".to_string());
        original_tracker
            .track_tab_focused("https://example.com", 1)
            .unwrap();

        let serialized = original_tracker.serialize_session(true);

        let fresh_tracker = Tracker::from_serialized("fresh".to_string(), serialized.data, true);

        assert!(fresh_tracker.root.contains_key("example.com"));
        let node = fresh_tracker.root.get("example.com").unwrap();
        assert_eq!(node.instances.len(), 0);
    }

    #[test]
    fn test_from_serialized_continue_session() {
        let mut original_tracker = Tracker::new("original".to_string());
        original_tracker
            .track_tab_focused("https://example.com", 1)
            .unwrap();

        let serialized = original_tracker.serialize_session(true);

        let continued_tracker =
            Tracker::from_serialized(serialized.session_name, serialized.data, false);

        assert!(continued_tracker.root.contains_key("example.com"));
        let node = continued_tracker.root.get("example.com").unwrap();
        assert_eq!(node.instances.len(), 1);
        assert_eq!(node.instances[0].tab_id, 1);
    }

    #[test]
    fn test_hierarchical_time_accumulation() {
        let mut tracker = Tracker::new("test".to_string());
        tracker
            .track_tab_focused("https://example.com/blog/post1", 1)
            .unwrap();
        sleep(Duration::from_millis(100));
        tracker
            .track_tab_closed("https://example.com/blog/post1", 1)
            .unwrap();
        let root_node = tracker.root.get("example.com").unwrap();
        let blog_node = root_node.children.get("blog").unwrap();
        let post1_node = blog_node.children.get("post1").unwrap();
        assert_eq!(blog_node.aggregate_time, 0);
        assert_eq!(root_node.aggregate_time, 0);
        assert!(post1_node.aggregate_time > 0);
    }
}
