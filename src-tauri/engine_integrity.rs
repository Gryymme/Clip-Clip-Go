use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};

pub fn verify(path: &Path, expected: &str) -> std::io::Result<bool> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    let actual: String = hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok(actual == expected)
}
