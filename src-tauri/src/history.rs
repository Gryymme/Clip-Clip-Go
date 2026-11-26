use serde::{Deserialize, Serialize};
use std::{io::Write, path::{Path, PathBuf}, sync::Mutex};
use tauri::Manager;
type Result<T> = std::result::Result<T, String>;
const READ_ERROR: &str = "History could not be read or uses an unsupported version. Preserve history-v1.json in app data, repair or move it aside, then Retry. It has not been overwritten.";
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Record {
    pub id: String, pub task: String, pub title: String, pub status: String,
    pub started_at: u64, pub finished_at: u64, pub summary: String,
    pub source: String, pub output: Option<String>, pub failure: Option<String>, pub category: String,
}
fn clean(s: &str, max: usize) -> String {
    let lower=s.to_lowercase();
    if ["http:", "https:", "data:", "token", "signature", "authorization", "cookie", "password", "secret", "referer", "?", "="].iter().any(|v|lower.contains(v)) { return "[redacted]".into(); }
    s.chars().filter(|c|!c.is_control()).take(max).collect()
}
impl Record {
    fn sanitize(mut self) -> Result<Self> {
        if self.id.len()>100 || !self.id.chars().all(|c|c.is_ascii_alphanumeric()||c=='-') || self.id.is_empty()
            || !["Converter","Images to PDF","Merge PDF","Downloader"].contains(&self.task.as_str())
            || !["completed","failed","cancelled"].contains(&self.status.as_str())
            || !["image","video","audio","document"].contains(&self.category.as_str())
            || self.started_at==0 || self.finished_at<self.started_at { return Err("Invalid History record.".into()); }
        self.title=clean(&self.title,300); self.source=clean(&self.source,300); self.summary=clean(&self.summary,300);
        // Persist only fixed failure categories, never arbitrary native diagnostics.
        self.failure=self.failure.map(|s|match s.as_str(){
            "Input unavailable. Select or inspect the source again." | "Output unavailable or already exists. Choose a new destination." | "Media unavailable or expired. Inspect it again." => s,
            _=>"The job failed. Check the source, output settings and destination.".into()
        });
        if self.status!="completed" { self.output=None; }
        if let Some(p)=&self.output { if p.len()>32768 || p.contains('\0') || !Path::new(p).is_absolute() { return Err("Invalid History output.".into()); } }
        Ok(self)
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Saved { version:u8, pub enabled:bool, pub records:Vec<Record>, seen:Vec<String> }
impl Default for Saved { fn default()->Self{Self{version:1,enabled:true,records:vec![],seen:vec![]}} }
#[derive(Default)]
pub struct Store { saved:Option<Saved>, suppressed:std::collections::HashSet<String> }
impl Store {
    fn load(&mut self,path:&Path)->Result<&Saved>{
        if self.saved.is_none(){
            if std::fs::metadata(path).is_ok_and(|m|m.len()>32*1024*1024){return Err(READ_ERROR.into());}
            let value=match std::fs::read(path){
                Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Saved::default(),
                Err(_)=>return Err(READ_ERROR.into()),
                Ok(bytes)=>{
                    if bytes.len()>32*1024*1024{return Err(READ_ERROR.into());}
                    let mut value:Saved=serde_json::from_slice(&bytes).map_err(|_|READ_ERROR)?;
                    if value.version!=1 || value.records.len()>500 || value.seen.len()>2000{return Err(READ_ERROR.into());}
                    value.records=value.records.into_iter().map(Record::sanitize).collect::<Result<_>>().map_err(|_|READ_ERROR)?;
                    value.records.sort_by(|a,b|b.finished_at.cmp(&a.finished_at)); value
                }
            }; self.saved=Some(value);
        } Ok(self.saved.as_ref().unwrap())
    }
    fn change(&mut self,path:&Path,op:Change)->Result<Saved>{
        let mut next=self.load(path)?.clone();
        match op {
            Change::Load=>return Ok(next),
            Change::Append{record}=>{
                let record=record.sanitize()?;
                if self.suppressed.contains(&record.id){return Ok(next);}
                if !next.enabled {if self.suppressed.len()<2000{self.suppressed.insert(record.id);}return Ok(next);}
                if next.seen.contains(&record.id)||next.records.iter().any(|r|r.id==record.id){return Ok(next);}
                next.seen.push(record.id.clone());
                if next.enabled {next.records.insert(0,record);}
            },
            Change::Remove{id}=>next.records.retain(|r|r.id!=id),
            Change::Clear=>next.records.clear(),
            Change::Enabled{enabled}=>next.enabled=enabled,
        }
        next.records.sort_by(|a,b|b.finished_at.cmp(&a.finished_at)); next.records.truncate(500);
        if next.seen.len()>2000 {next.seen.drain(..next.seen.len()-2000);}
        let parent=path.parent().ok_or("History storage is unavailable.")?;
        std::fs::create_dir_all(parent).map_err(|_|"History could not be saved. Check app-data permissions and disk space, then Retry.")?;
        let write=||->std::io::Result<()>{
            let mut temp=tempfile::NamedTempFile::new_in(parent)?;
            temp.write_all(&serde_json::to_vec(&next)?)?;temp.as_file().sync_all()?;
            temp.persist(path).map_err(|e|e.error)?;Ok(())
        };
        write().map_err(|_|"History could not be saved. Check app-data permissions and disk space, then Retry.")?;
        self.saved=Some(next.clone());Ok(next)
    }
}
#[derive(Deserialize)]
#[serde(tag="action",rename_all="camelCase",deny_unknown_fields)]
pub enum Change { Load, Append{record:Record}, Remove{id:String}, Clear, Enabled{enabled:bool} }
#[derive(Default)]
pub struct Runtime(Mutex<Store>);
fn location(app:&tauri::AppHandle)->Result<PathBuf>{Ok(app.path().app_data_dir().map_err(|_|"App-data storage is unavailable.")?.join("history-v1.json"))}
#[tauri::command]
pub async fn history_change(app:tauri::AppHandle,state:tauri::State<'_,Runtime>,core:tauri::State<'_,crate::conversion::Runtime>,change:Change)->Result<Saved>{
    if let Change::Append{record}=&change {if record.status=="completed" && record.output.as_ref().is_some_and(|p|!core.core.owned_output(Path::new(p))){return Err("The output was not published by this session.".into());}}
    state.0.lock().unwrap().change(&location(&app)?,change)
}
#[tauri::command]
pub fn history_open(app:tauri::AppHandle,state:tauri::State<'_,Runtime>,id:String,folder:bool)->Result<()>{
    let output={let mut store=state.0.lock().unwrap();let saved=store.load(&location(&app)?)?;
        saved.records.iter().find(|r|r.id==id&&r.status=="completed").and_then(|r|r.output.clone()).ok_or("This History output is unavailable.")?};
    crate::session::open_saved_path(Path::new(&output),folder)
}

#[cfg(test)]
mod tests {
 use super::*;
 fn dir()->tempfile::TempDir {let root=Path::new(env!("CARGO_MANIFEST_DIR")).join("target/history-tests");std::fs::create_dir_all(&root).unwrap();tempfile::tempdir_in(root).unwrap()}
 fn record(n:u64,status:&str)->Record{Record{id:format!("attempt-{n}"),task:"Converter".into(),title:"Fixture 王秀英".into(),status:status.into(),started_at:1,finished_at:n+1,summary:"FLAC".into(),source:"tone.wav".into(),output:Some(r"C:\fixture.flac".into()),failure:Some("https://media.test/item?signature=private Cookie: password".into()),category:"audio".into()}}
 #[test] fn persistence_order_dedup_removal_clear_and_toggle(){
  let d=dir();let path=d.path().join("history.json");let mut s=Store::default();assert!(s.change(&path,Change::Load).unwrap().records.is_empty());
  for n in 0..503{s.change(&path,Change::Append{record:record(n,if n%3==0{"completed"}else if n%3==1{"failed"}else{"cancelled"})}).unwrap();}
  let saved=Store::default().change(&path,Change::Load).unwrap();assert_eq!(saved.records.len(),500);assert_eq!(saved.records[0].id,"attempt-502");
  s.change(&path,Change::Remove{id:"attempt-502".into()}).unwrap();assert_eq!(s.change(&path,Change::Append{record:record(502,"failed")}).unwrap().records.len(),499);
  s.change(&path,Change::Enabled{enabled:false}).unwrap();assert_eq!(s.change(&path,Change::Append{record:record(600,"completed")}).unwrap().records.len(),499);
  assert!(!Store::default().change(&path,Change::Load).unwrap().enabled);
  s.change(&path,Change::Clear).unwrap();s.change(&path,Change::Enabled{enabled:true}).unwrap();assert!(s.change(&path,Change::Append{record:record(600,"completed")}).unwrap().records.is_empty());
  let final_value=s.change(&path,Change::Append{record:record(601,"completed")}).unwrap();assert_eq!(final_value.records.len(),1);assert_eq!(final_value.records[0].status,"completed");
  // Missing output files do not rewrite historical success.
  assert_eq!(Store::default().change(&path,Change::Load).unwrap().records[0].status,"completed");
 }
 #[test] fn malformed_unsupported_and_write_failure_preserve_bytes(){
  let d=dir();let path=d.path().join("history.json");
  for bytes in [b"not json".as_slice(),br#"{"version":2,"enabled":true,"records":[],"seen":[]}"#]{std::fs::write(&path,bytes).unwrap();assert!(Store::default().change(&path,Change::Clear).is_err());assert_eq!(std::fs::read(&path).unwrap(),bytes);}
  let bad=d.path().join("as-directory");std::fs::create_dir(&bad).unwrap();let mut s=Store{saved:Some(Saved::default()),..Store::default()};assert!(s.change(&bad,Change::Append{record:record(1,"failed")}).is_err());assert!(s.saved.unwrap().records.is_empty());
 }
 #[test] fn privacy_allowlist_and_status_validation(){
  let mut r=record(1,"failed");r.title="https://signed.test/?token=private".into();r.source="Referer: secret".into();let r=r.sanitize().unwrap();let json=serde_json::to_string(&r).unwrap();for secret in ["signed.test","token","private","Referer","secret","Cookie"]{assert!(!json.contains(secret));}assert!(r.output.is_none());assert!(record(2,"waiting").sanitize().is_err());
 }
}
