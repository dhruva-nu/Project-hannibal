mod go;
mod python;
mod zig;

pub fn translate(dsl: &str, language: &str) -> String {
    match language {
        "python" => python::emit(dsl),
        "zig" => zig::emit(dsl),
        "go" => go::emit(dsl),
        unsupported => format!("// unsupported language: {unsupported}"),
    }
}
