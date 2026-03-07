#!/usr/bin/env bash
set -euo pipefail

INPUT_DIR="${1:-incoming/chatgpt-ideas}"
PROCESSED_DIR="$INPUT_DIR/processed"
OUTPUT_DIR="content/posts"

if [[ ! -d "$INPUT_DIR" ]]; then
  echo "Input directory not found: $INPUT_DIR" >&2
  exit 1
fi

mkdir -p "$PROCESSED_DIR" "$OUTPUT_DIR"

trim() {
  local s="$1"
  s="${s#${s%%[![:space:]]*}}"
  s="${s%${s##*[![:space:]]}}"
  printf '%s' "$s"
}

slugify() {
  local s="$1"
  s="$(printf '%s' "$s" | tr '[:upper:]' '[:lower:]')"
  s="$(printf '%s' "$s" | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
  printf '%s' "$s"
}

escape_toml() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

shopt -s nullglob
files=("$INPUT_DIR"/*.md)

if (( ${#files[@]} == 0 )); then
  echo "No .md files found in $INPUT_DIR"
  exit 0
fi

imported=0
skipped=0

for file in "${files[@]}"; do
  base="$(basename "$file")"
  if [[ "$base" == "FORMAT.md" ]] || [[ "$base" == "README.md" ]]; then
    continue
  fi

  title_line="$(sed -n '1p' "$file")"
  date_line="$(sed -n '2p' "$file")"
  tags_line="$(sed -n '3p' "$file")"
  summary_line="$(sed -n '4p' "$file")"
  divider_line="$(sed -n '5p' "$file")"

  if [[ "$title_line" != Title:* ]] || [[ "$date_line" != Date:* ]] || [[ "$tags_line" != Tags:* ]] || [[ "$summary_line" != Summary:* ]] || [[ "$divider_line" != '---' ]]; then
    echo "Skipping $base: invalid header format"
    ((skipped+=1))
    continue
  fi

  raw_title="$(trim "${title_line#Title:}")"
  raw_date="$(trim "${date_line#Date:}")"
  raw_tags="$(trim "${tags_line#Tags:}")"
  raw_summary="$(trim "${summary_line#Summary:}")"

  if ! [[ "$raw_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "Skipping $base: invalid date '$raw_date'"
    ((skipped+=1))
    continue
  fi

  if [[ -z "$raw_title" ]]; then
    echo "Skipping $base: empty title"
    ((skipped+=1))
    continue
  fi

  slug="$(slugify "$raw_title")"
  if [[ -z "$slug" ]]; then
    slug="idea"
  fi

  out="$OUTPUT_DIR/${raw_date}-${slug}.md"
  i=1
  while [[ -f "$out" ]]; do
    out="$OUTPUT_DIR/${raw_date}-${slug}-${i}.md"
    ((i+=1))
  done

  mapfile -t tag_arr < <(printf '%s' "$raw_tags" | tr ',' '\n' | sed -E 's/^\s+//; s/\s+$//' | sed '/^$/d')
  tag_toml=""
  if (( ${#tag_arr[@]} > 0 )); then
    for tag in "${tag_arr[@]}"; do
      escaped_tag="$(escape_toml "$tag")"
      if [[ -n "$tag_toml" ]]; then
        tag_toml+=", "
      fi
      tag_toml+="\"$escaped_tag\""
    done
  fi

  escaped_title="$(escape_toml "$raw_title")"
  escaped_summary="$(escape_toml "$raw_summary")"

  {
    echo '+++'
    echo "title = \"$escaped_title\""
    echo "date = ${raw_date}T09:00:00-08:00"
    echo 'draft = true'
    if [[ -n "$escaped_summary" ]]; then
      echo "summary = \"$escaped_summary\""
    fi
    if [[ -n "$tag_toml" ]]; then
      echo "tags = [$tag_toml]"
    fi
    echo 'chat_source = "chatgpt-history"'
    echo '+++'
    echo
    sed -n '6,$p' "$file"
  } > "$out"

  mv "$file" "$PROCESSED_DIR/$base"
  echo "Imported: $base -> $out"
  ((imported+=1))
done

echo
printf 'Done. imported=%d skipped=%d\n' "$imported" "$skipped"
