use std::{fs,path::Path};
use std::os::unix::fs::MetadataExt;
fn main() {
 let dir=std::env::args().nth(1).unwrap(); let dir=Path::new(&dir); fs::create_dir(dir).unwrap();
 let original=dir.join("CaseGuide.pdf"); let alias=dir.join("CASEGUIDE.PDF"); fs::write(&original,b"Synthetic referenced bytes").unwrap();
 println!("alias_exists={}",alias.exists());
 if alias.exists() {
  let a=original.canonicalize().unwrap(); let b=alias.canonicalize().unwrap();
  let am=fs::metadata(&original).unwrap();let bm=fs::metadata(&alias).unwrap();
  println!("canonical_paths_equal={}",a==b);println!("same_device_and_inode={}",am.dev()==bm.dev()&&am.ino()==bm.ino());
  println!("original_name={:?} alias_name={:?}",a.file_name(),b.file_name());
 }
 fs::remove_file(original).unwrap();fs::remove_dir(dir).unwrap();
}
