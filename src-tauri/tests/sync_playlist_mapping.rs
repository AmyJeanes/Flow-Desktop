//! Playlist item add times: desktop keeps `addedAtInPlaylist` on each stored track and sends it as
//! the item's `added_at_ms`, 0 when unknown; an item from Android (no `raw`) brings its `added_at_ms`
//! back in when known (non-zero), and a merge keeps the earliest known time.

use flow_desktop_lib::sync::canonical::{Hlc, Playlist, PlaylistItem, PlaylistOrigin};
use flow_desktop_lib::sync::mapping::{
    WATCH_LATER_SYNC_ID, parse_playlists_blob, playlists_to_blob,
};
use flow_desktop_lib::sync::merge::merge_playlists;
use serde_json::Value;

const CREATED: &str = "2025-01-01T00:00:00.000Z";

#[test]
fn a_track_add_time_becomes_the_item_add_time() {
    let blob = serde_json::json!([{
        "id": "playlist-1",
        "name": "Mine",
        "source": "Owned",
        "createdAt": CREATED,
        "tracks": [
            { "id": "timed", "title": "t", "channelName": "c", "addedAtInPlaylist": 1_760_000_000_000_u64 },
            { "id": "untimed", "title": "u", "channelName": "c" }
        ]
    }])
    .to_string();

    let playlists = parse_playlists_blob(&blob, "dev-a");
    let items = &playlists[0].items;
    assert_eq!(items[0].added_at_ms, 1_760_000_000_000);
    assert_eq!(items[1].added_at_ms, 0);
}

// Newer than the desktop copy, as Android stamps every item with the time it exports.
fn foreign_playlist(added_at_ms: u64) -> Playlist {
    let hlc = Hlc::new(1_800_000_000_000, 0, "android");
    Playlist {
        sync_id: WATCH_LATER_SYNC_ID.into(),
        origin: PlaylistOrigin::Local,
        is_protected: true,
        created_at_ms: 1_700_000_000_000,
        updated_hlc: hlc.clone(),
        items: vec![PlaylistItem {
            video_id: "vid".into(),
            position: 0,
            added_at_ms,
            title: Some("t".into()),
            hlc,
            ..PlaylistItem::default()
        }],
        ..Playlist::default()
    }
}

fn first_track(blob: &str) -> Value {
    let arr: Vec<Value> = serde_json::from_str(blob).unwrap();
    arr[0]["tracks"][0].clone()
}

#[test]
fn a_foreign_item_keeps_a_known_add_time() {
    let track = first_track(&playlists_to_blob(&[foreign_playlist(1_760_000_000_000)]));
    assert_eq!(track["addedAtInPlaylist"], 1_760_000_000_000_u64);
}

#[test]
fn a_foreign_item_without_an_add_time_stays_untimed() {
    let track = first_track(&playlists_to_blob(&[foreign_playlist(0)]));
    assert!(track.get("addedAtInPlaylist").is_none());
}

fn desktop_watch_later(added_at_ms: u64) -> Vec<Playlist> {
    let blob = serde_json::json!([{
        "id": "watch-later",
        "name": "Watch Later",
        "isProtected": true,
        "createdAt": CREATED,
        "tracks": [{ "id": "vid", "title": "t", "channelName": "c", "addedAtInPlaylist": added_at_ms }]
    }])
    .to_string();
    parse_playlists_blob(&blob, "desktop")
}

#[test]
fn an_android_echo_without_an_add_time_keeps_the_desktop_one() {
    // Android re-exports every item with a newer HLC and 0 for its add time.
    let merged = merge_playlists(
        desktop_watch_later(1_760_000_000_000),
        vec![foreign_playlist(0)],
    );
    let track = first_track(&playlists_to_blob(&merged));
    assert_eq!(track["addedAtInPlaylist"], 1_760_000_000_000_u64);
}

#[test]
fn a_merge_keeps_the_earliest_known_add_time() {
    let merged = merge_playlists(
        desktop_watch_later(1_750_000_000_000),
        vec![foreign_playlist(1_760_000_000_000)],
    );
    let track = first_track(&playlists_to_blob(&merged));
    assert_eq!(track["addedAtInPlaylist"], 1_750_000_000_000_u64);
}
