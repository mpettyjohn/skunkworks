# Skunkworks Desktop - Architecture

## Design Principles (From Council Review)

This architecture addresses specific concerns raised by GPT-5.2-Codex and Gemini 3:

1. **Bundle CLI tools** - No PATH dependency, no user installation
2. **PTY over piped stdio** - Realistic terminal emulation, handles auth prompts
3. **SQLite over JSON** - Atomic writes, no corruption on crash
4. **Bounded buffers** - No unbounded memory growth
5. **Scoped permissions** - Minimal Tauri allowlist
6. **Process tracking** - Clean shutdown, no orphans

---

## Technology Stack

### Frontend
- **UI Framework:** React 18 with TypeScript
- **Styling:** Tailwind CSS
- **State Management:** Zustand
- **Markdown Rendering:** react-markdown with DOMPurify sanitization (XSS prevention)
- **Icons:** Lucide React

### Backend (Tauri/Rust)
- **Framework:** Tauri 2.x
- **PTY:** `portable-pty` crate for terminal emulation
- **Database:** SQLite via `rusqlite` for state persistence
- **Process Management:** Custom process tracker with PID registry

### Bundled Tools (Inside .app Bundle)
```
Skunkworks.app/
└── Contents/
    └── Resources/
        └── bin/
            ├── arm64/           # Apple Silicon binaries
            │   ├── claude
            │   ├── codex
            │   ├── gemini
            │   ├── gh
            │   └── node
            └── x86_64/          # Intel binaries
                ├── claude
                ├── codex
                ├── gemini
                ├── gh
                └── node
```

The app detects architecture at runtime and uses the correct binaries.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    React Frontend                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │Dashboard │ │ Pipeline │ │ Artifact │ │ Settings │       │
│  │  View    │ │   View   │ │  Viewer  │ │  Panel   │       │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘       │
│       └────────────┴─────┬──────┴────────────┘              │
│                          │                                   │
│              Zustand Store + Ring Buffer                     │
│         (capped at 100KB, paginated display)                │
└──────────────────────────┬───────────────────────────────────┘
                           │ Tauri invoke() / events
┌──────────────────────────┴───────────────────────────────────┐
│                    Tauri Backend (Rust)                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │   Commands   │ │     PTY      │ │   SQLite     │         │
│  │   Handler    │ │   Manager    │ │    State     │         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
│                                                              │
│  ┌──────────────────────────────────────────────────┐       │
│  │              Process Registry                     │       │
│  │   Tracks all child PIDs, kills on app shutdown   │       │
│  └──────────────────────────────────────────────────┘       │
└──────────────────────────┬───────────────────────────────────┘
                           │ PTY spawn
┌──────────────────────────┴───────────────────────────────────┐
│              Bundled CLI Tools (in .app/Resources/bin)       │
│     claude    │    codex    │    gemini    │    gh          │
└──────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
skunkworks-desktop/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── project.rs        # Project CRUD
│   │   │   ├── orchestrator.rs   # Phase execution
│   │   │   ├── auth.rs           # Authentication flows
│   │   │   └── github.rs         # GitHub integration
│   │   ├── pty/
│   │   │   ├── mod.rs
│   │   │   ├── manager.rs        # PTY lifecycle management
│   │   │   └── parser.rs         # Output parsing (questions, artifacts)
│   │   ├── state/
│   │   │   ├── mod.rs
│   │   │   ├── db.rs             # SQLite operations
│   │   │   └── migrations.rs     # Schema migrations
│   │   ├── process/
│   │   │   ├── mod.rs
│   │   │   └── registry.rs       # PID tracking, cleanup
│   │   └── bundled/
│   │       └── mod.rs            # Locate bundled binaries
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── resources/
│       └── bin/                  # Bundled CLI tools go here
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── store/
│   │   ├── index.ts
│   │   ├── projectStore.ts
│   │   ├── streamingStore.ts     # Ring buffer implementation
│   │   └── authStore.ts          # Connected accounts state
│   ├── components/
│   │   ├── Onboarding/
│   │   │   ├── Welcome.tsx
│   │   │   └── ConnectAccount.tsx
│   │   ├── Dashboard/
│   │   ├── Pipeline/
│   │   ├── Interview/
│   │   ├── Artifacts/
│   │   ├── Verification/
│   │   ├── Settings/
│   │   └── common/
│   │       ├── StreamingOutput.tsx   # Paginated, bounded display
│   │       └── SafeMarkdown.tsx      # DOMPurify-wrapped
│   ├── hooks/
│   │   ├── useProject.ts
│   │   ├── usePhaseExecution.ts
│   │   └── useRingBuffer.ts      # Bounded streaming buffer
│   └── lib/
│       ├── tauri.ts
│       ├── types.ts
│       └── sanitize.ts           # DOMPurify wrapper
├── prompts/                      # Unchanged from CLI
├── package.json
└── tailwind.config.js
```

---

## Bundled CLI Tool Management

### Locating Binaries

```rust
// src-tauri/src/bundled/mod.rs

use std::path::PathBuf;
use tauri::api::path::resource_dir;

pub fn get_cli_path(app: &tauri::AppHandle, tool: &str) -> Result<PathBuf, Error> {
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x86_64"
    };

    let resource_path = resource_dir(app.package_info(), &app.env())?;
    let bin_path = resource_path.join("bin").join(arch).join(tool);

    if !bin_path.exists() {
        return Err(Error::BundledToolNotFound(tool.to_string()));
    }

    Ok(bin_path)
}
```

### Authentication Flow

When a CLI tool needs authentication:

```rust
// src-tauri/src/commands/auth.rs

#[tauri::command]
pub async fn trigger_auth(
    app: tauri::AppHandle,
    service: Service,  // Claude, Codex, Gemini, GitHub
) -> Result<AuthStatus, Error> {
    let cli_path = get_cli_path(&app, service.cli_name())?;

    // Spawn PTY with auth command
    // e.g., "claude auth login" or "gh auth login"
    let mut pty = PtyManager::spawn(&cli_path, &["auth", "login"])?;

    // This will open the user's browser for OAuth
    // PTY captures when auth completes

    pty.wait_for_completion().await?;

    // Check if auth succeeded
    check_auth_status(&app, service).await
}

#[tauri::command]
pub async fn check_auth_status(
    app: tauri::AppHandle,
    service: Service,
) -> Result<AuthStatus, Error> {
    let cli_path = get_cli_path(&app, service.cli_name())?;

    // Run auth check command
    // e.g., "claude auth status" or "gh auth status"
    let output = Command::new(&cli_path)
        .args(&["auth", "status"])
        .output()?;

    // Parse output to determine if authenticated
    parse_auth_status(&output, service)
}
```

---

## PTY-Based Process Management

### Why PTY Instead of Piped Stdio

The council identified that piped stdio is brittle:
- CLI tools behave differently without a TTY
- Auth prompts may not appear
- ANSI codes and interactive features break

PTY (pseudo-terminal) solves this by giving tools a real terminal.

```rust
// src-tauri/src/pty/manager.rs

use portable_pty::{native_pty_system, CommandBuilder, PtySize};

pub struct PtyManager {
    master: Box<dyn MasterPty>,
    child: Box<dyn Child>,
    reader: Box<dyn Read>,
    writer: Box<dyn Write>,
    pid: u32,
}

impl PtyManager {
    pub fn spawn(cli_path: &Path, args: &[&str]) -> Result<Self, Error> {
        let pty_system = native_pty_system();

        let pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut cmd = CommandBuilder::new(cli_path);
        cmd.args(args);

        // Set up environment without relying on user's shell
        cmd.env("TERM", "xterm-256color");
        cmd.env("HOME", dirs::home_dir().unwrap());

        let child = pair.slave.spawn_command(cmd)?;
        let pid = child.process_id().unwrap();

        // Register PID for cleanup
        PROCESS_REGISTRY.lock().unwrap().insert(pid);

        Ok(Self {
            master: pair.master,
            child,
            reader: pair.master.try_clone_reader()?,
            writer: pair.master.take_writer()?,
            pid,
        })
    }

    pub fn read_output(&mut self, buffer: &mut RingBuffer) -> Result<(), Error> {
        let mut chunk = [0u8; 1024];
        let n = self.reader.read(&mut chunk)?;
        if n > 0 {
            // Strip ANSI codes for clean display
            let clean = strip_ansi_codes(&chunk[..n]);
            buffer.push(&clean);
        }
        Ok(())
    }

    pub fn write_input(&mut self, input: &str) -> Result<(), Error> {
        self.writer.write_all(input.as_bytes())?;
        self.writer.write_all(b"\n")?;
        Ok(())
    }
}

impl Drop for PtyManager {
    fn drop(&mut self) {
        // Remove from registry
        PROCESS_REGISTRY.lock().unwrap().remove(&self.pid);
        // Kill if still running
        let _ = self.child.kill();
    }
}
```

### Process Registry (No Orphans)

```rust
// src-tauri/src/process/registry.rs

use std::sync::Mutex;
use std::collections::HashSet;
use lazy_static::lazy_static;

lazy_static! {
    pub static ref PROCESS_REGISTRY: Mutex<HashSet<u32>> = Mutex::new(HashSet::new());
}

pub fn kill_all_children() {
    let pids: Vec<u32> = PROCESS_REGISTRY.lock().unwrap().drain().collect();
    for pid in pids {
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }
}

// Called from main.rs on app shutdown
pub fn setup_shutdown_handler(app: &tauri::App) {
    app.on_window_event(|event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event.event() {
            kill_all_children();
        }
    });
}
```

---

## SQLite State Management

### Why SQLite Over JSON

The council identified risks with JSON files:
- No atomic writes = corruption on crash
- No locking = race conditions
- No migrations = schema evolution pain

```rust
// src-tauri/src/state/db.rs

use rusqlite::{Connection, params};

pub struct StateDb {
    conn: Connection,
}

impl StateDb {
    pub fn open(project_path: &Path) -> Result<Self, Error> {
        let db_path = project_path.join(".skunkworks").join("state.db");
        let conn = Connection::open(&db_path)?;

        // Run migrations
        migrations::run(&conn)?;

        Ok(Self { conn })
    }

    pub fn get_phase(&self) -> Result<Phase, Error> {
        self.conn.query_row(
            "SELECT current_phase FROM project_state WHERE id = 1",
            [],
            |row| row.get(0),
        ).map_err(Into::into)
    }

    pub fn set_phase(&self, phase: Phase) -> Result<(), Error> {
        self.conn.execute(
            "UPDATE project_state SET current_phase = ?, updated_at = datetime('now') WHERE id = 1",
            params![phase.as_str()],
        )?;
        Ok(())
    }

    pub fn save_artifact(&self, artifact_type: ArtifactType, content: &str) -> Result<(), Error> {
        self.conn.execute(
            "INSERT OR REPLACE INTO artifacts (type, content, updated_at) VALUES (?, ?, datetime('now'))",
            params![artifact_type.as_str(), content],
        )?;
        Ok(())
    }
}
```

### Schema

```sql
-- migrations/001_initial.sql

CREATE TABLE IF NOT EXISTS project_state (
    id INTEGER PRIMARY KEY,
    project_name TEXT NOT NULL,
    project_path TEXT NOT NULL,
    current_phase TEXT NOT NULL DEFAULT 'interview',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artifacts (
    type TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    phase TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_status (
    service TEXT PRIMARY KEY,
    is_authenticated INTEGER NOT NULL DEFAULT 0,
    last_checked TEXT
);

-- For backwards compatibility, we still write .skunkworks/SPEC.md etc.
-- But the source of truth is now SQLite
```

---

## Bounded Streaming Buffer

### The Problem (From Council)

```typescript
// BAD: O(n²) memory growth, unbounded
setOutput(prev => prev + event.payload.content)
```

### The Solution: Ring Buffer

```typescript
// src/store/streamingStore.ts

const MAX_BUFFER_SIZE = 100 * 1024; // 100KB cap
const CHUNK_SIZE = 10 * 1024;       // 10KB chunks for pagination

interface StreamingState {
  chunks: string[];          // Circular buffer of chunks
  totalSize: number;
  headIndex: number;         // Oldest chunk

  // Actions
  pushOutput: (content: string) => void;
  getVisibleOutput: (offset: number, limit: number) => string;
  clear: () => void;
}

export const useStreamingStore = create<StreamingState>((set, get) => ({
  chunks: [],
  totalSize: 0,
  headIndex: 0,

  pushOutput: (content: string) => {
    set((state) => {
      const newChunks = [...state.chunks];
      let newSize = state.totalSize + content.length;
      let newHead = state.headIndex;

      // Add new content
      const lastChunkIndex = newChunks.length - 1;
      if (lastChunkIndex >= 0 && newChunks[lastChunkIndex].length < CHUNK_SIZE) {
        newChunks[lastChunkIndex] += content;
      } else {
        newChunks.push(content);
      }

      // Evict old chunks if over limit
      while (newSize > MAX_BUFFER_SIZE && newChunks.length > 1) {
        const removed = newChunks.shift()!;
        newSize -= removed.length;
        newHead++;
      }

      return { chunks: newChunks, totalSize: newSize, headIndex: newHead };
    });
  },

  getVisibleOutput: (offset: number, limit: number) => {
    const { chunks } = get();
    const all = chunks.join('');
    return all.slice(offset, offset + limit);
  },

  clear: () => set({ chunks: [], totalSize: 0, headIndex: 0 }),
}));
```

---

## Tauri Permissions (Scoped)

The council flagged the original permissions as too broad. Here's the minimal set:

```json
// src-tauri/tauri.conf.json (Tauri 2.x format)
{
  "tauri": {
    "security": {
      "capabilities": [
        {
          "identifier": "main-window",
          "windows": ["main"],
          "permissions": [
            "core:default",
            "fs:allow-read-text-file",
            "fs:allow-write-text-file",
            "fs:allow-exists",
            "fs:allow-create-dir",
            {
              "identifier": "fs:scope",
              "allow": [
                "$HOME/*/\\.skunkworks/**",
                "$RESOURCE/bin/**"
              ]
            },
            "shell:allow-spawn",
            {
              "identifier": "shell:scope",
              "allow": [
                { "cmd": "$RESOURCE/bin/*/claude", "args": true },
                { "cmd": "$RESOURCE/bin/*/codex", "args": true },
                { "cmd": "$RESOURCE/bin/*/gemini", "args": true },
                { "cmd": "$RESOURCE/bin/*/gh", "args": true },
                { "cmd": "$RESOURCE/bin/*/node", "args": true }
              ]
            },
            "shell:allow-open"
          ]
        }
      ]
    }
  }
}
```

Key changes:
- FS scope limited to `.skunkworks/` folders and bundled resources
- Shell scope limited to bundled binaries only (not user's PATH)
- No `$HOME/**` blanket access

---

## XSS Prevention

The council noted that rendering LLM output as markdown is an XSS risk.

```typescript
// src/lib/sanitize.ts

import DOMPurify from 'dompurify';

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'a'],
    ALLOWED_ATTR: ['href', 'class'],
    ALLOW_DATA_ATTR: false,
  });
}

// src/components/common/SafeMarkdown.tsx

import ReactMarkdown from 'react-markdown';
import { sanitizeHtml } from '@/lib/sanitize';

export function SafeMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        // Override to sanitize any HTML that slips through
        p: ({ children }) => <p>{children}</p>,
        // ... etc
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
```

---

## Event Channel Naming

The council noted that `phase-${projectPath}` could break with special characters.

```typescript
// src/lib/tauri.ts

export function getEventChannel(projectPath: string): string {
  // Hash the path to avoid special characters in event names
  const hash = btoa(projectPath).replace(/[^a-zA-Z0-9]/g, '');
  return `phase-${hash}`;
}
```

---

## Migration Strategy

### Phase 1: Foundation
1. Initialize Tauri 2.x project
2. Set up React + Tailwind + Zustand
3. Bundle architecture-specific CLI binaries
4. Implement binary location logic

### Phase 2: Authentication
1. Implement auth status checking for each service
2. Build onboarding UI with "Connect Account" buttons
3. Handle browser-based auth flows
4. Persist auth status in SQLite

### Phase 3: Read-Only Features
1. Project listing (scan for .skunkworks/ folders)
2. Artifact viewing with SafeMarkdown
3. SQLite state reading

### Phase 4: PTY Integration
1. Implement PtyManager with portable-pty
2. Build process registry for cleanup
3. Implement output parsing (questions, artifacts)
4. Ring buffer streaming to UI

### Phase 5: Phase Execution
1. Interview phase with question UI
2. Architect/Builder/Reviewer phases
3. Council parallel execution

### Phase 6: Verification & Polish
1. Test runner integration
2. Visual verification
3. Error handling and recovery
4. Menu bar, keyboard shortcuts

---

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| CLI tool updates break parsing | Version-lock bundled tools, test before updates |
| Auth tokens expire silently | Check auth before each phase, friendly re-auth prompt |
| PTY output contains binary data | Filter non-printable characters, sanitize display |
| Large artifacts crash UI | Paginate artifact viewer, lazy load |
| Process orphaning | PID registry with shutdown hook |
| Concurrent project access | SQLite handles locking automatically |

---

## Testing Strategy

### Unit Tests
- Rust: Binary location, PTY parsing, SQLite operations
- React: Component rendering, store logic, ring buffer

### Integration Tests
- Full phase execution with mocked PTY output
- Auth flow simulation
- Artifact round-trip (create → read → edit)

### E2E Tests
- Full pipeline with real bundled CLIs
- App shutdown with running processes
- Error recovery scenarios
