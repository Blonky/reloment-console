// Agent → Knowledge (r13). A Sauna-memory-style document list: a left column of
// doc cards grouped by kind (Company / House rules / FAQs / Files), each with a
// title, one-line preview and updated-at; clicking opens an inline editor on the
// right (title + body + Delete). Autosave on blur. Everything here is folded into
// the agent's context. 'file' entries are an honest demo affordance — an "Add
// file" records a filename + size and is labelled "indexed" (no real upload).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useClient } from '../../shell/ClientContext.tsx';
import { useData } from '../../data/useData.ts';
import { Skeleton } from '../../components/index.ts';
import type { KnowledgeDoc, KnowledgeKind } from '../../data/types.ts';
import styles from './KnowledgeSegment.module.css';

const CAPTION =
  "Everything here is folded into your agent's context — it drafts with what you teach it.";

// The honest status a binary file carries in demo mode (mirrors the client). A
// file doc whose body is this string was NOT parsed here — the real parse runs on
// the platform connection. Text files carry their real content instead.
const BINARY_NOTE = 'Parsed on the platform connection';

const GROUPS: { kind: KnowledgeKind; label: string; empty: string }[] = [
  { kind: 'company', label: 'Company', empty: 'Nothing here yet — the agent works from your book alone.' },
  { kind: 'rules', label: 'House rules', empty: 'Nothing here yet — the agent works from your book alone.' },
  { kind: 'faq', label: 'FAQs', empty: 'Nothing here yet — the agent works from your book alone.' },
  { kind: 'file', label: 'Files', empty: 'Drop a file here, or use Add file. Text files are read in; PDFs are parsed on the platform connection.' },
];

const WISP_MS = 1600;

// Read a File to a base64 payload (no data-URL prefix) for uploadKnowledgeFile.
// Resolves to null on read failure so the caller can skip it quietly.
function fileToBase64(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') return resolve(null);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
  return `${n} B`;
}

function formatUpdated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function oneLine(body: string): string {
  const one = body.replaceAll(/\s+/g, ' ').trim();
  return one.length > 72 ? `${one.slice(0, 71)}…` : one || 'Empty';
}

function TrashGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8h6l.5-8" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

// ── The inline editor panel (right column) ──────────────────────────────────
function DocEditor({
  doc,
  onSave,
  onDelete,
}: {
  doc: KnowledgeDoc;
  onSave: (patch: { title?: string; body?: string }) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body);

  // Resync when a different doc is opened.
  useEffect(() => {
    setTitle(doc.title);
    setBody(doc.body);
  }, [doc.id, doc.title, doc.body]);

  const isFile = doc.kind === 'file';

  return (
    <div className={styles.editor}>
      <input
        className={styles.titleInput}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title !== doc.title) onSave({ title });
        }}
        aria-label="Document title"
      />

      {isFile && (
        <p className={styles.fileMeta}>
          {doc.body === BINARY_NOTE ? (
            <span className={styles.platformPill}>Parsed on the platform connection</span>
          ) : (
            <span className={styles.indexedPill}>Read in</span>
          )}
          {doc.filename}
          {doc.size_bytes !== undefined ? ` · ${formatBytes(doc.size_bytes)}` : ''}
        </p>
      )}

      <textarea
        className={styles.bodyInput}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => {
          if (body !== doc.body) onSave({ body });
        }}
        placeholder={
          isFile
            ? 'Add a note about what this file covers (optional)…'
            : 'What should the agent know?'
        }
        aria-label="Document body"
      />

      <div className={styles.editorFoot}>
        <span className={styles.updatedAt}>Updated {formatUpdated(doc.updated_at)}</span>
        <button type="button" className={styles.deleteBtn} onClick={onDelete}>
          <TrashGlyph />
          Delete
        </button>
      </div>
    </div>
  );
}

function KnowledgeSkeleton() {
  return (
    <div className={styles.card}>
      <div className={styles.list}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={styles.docCard}>
            <Skeleton width="60%" height={13} />
            <Skeleton width="90%" height={11} />
          </div>
        ))}
      </div>
      <div className={styles.editorPane}>
        <Skeleton width="100%" height={200} radius="var(--radius)" />
      </div>
    </div>
  );
}

export default function KnowledgeSegment() {
  const client = useClient();
  const docs = useData(() => client.knowledgeDocs(), [client]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const wispTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (wispTimer.current) clearTimeout(wispTimer.current);
    },
    [],
  );

  const flashSaved = useCallback(() => {
    setSaved(true);
    if (wispTimer.current) clearTimeout(wispTimer.current);
    wispTimer.current = setTimeout(() => setSaved(false), WISP_MS);
  }, []);

  // Live wiring (r19): refetch the doc list whenever the brain changes — an upload
  // finishing, a Home teach intent, or a mutation in another tab. Cheap: one
  // subscription that only refetches on knowledge.changed while this segment is
  // mounted, so a taught doc appears here with no manual reload.
  useEffect(() => {
    const unsubscribe = client.subscribe((e) => {
      if (e.type === 'knowledge.changed') docs.refetch();
    });
    return unsubscribe;
    // docs.refetch is stable; client is the only real dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const list = docs.data;

  const selected = list?.find((d) => d.id === selectedId) ?? null;

  // Read each dropped/picked file client-side and upload it. Text-like files land
  // with their real content as the body (chunked when long); binaries record
  // metadata with the honest "Parsed on the platform connection" status. The
  // knowledge.changed event refetches the list; we also select the newest file so
  // the operator sees it land. Runs sequentially so ids/stamps stay ordered.
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      try {
        for (const file of files) {
          const content_base64 = await fileToBase64(file);
          if (content_base64 === null) continue;
          await client.uploadKnowledgeFile({
            filename: file.name,
            mime_type: file.type,
            content_base64,
          });
        }
        flashSaved();
        const after = await client.knowledgeDocs();
        const newestFile = [...after].reverse().find((d) => d.kind === 'file');
        if (newestFile) setSelectedId(newestFile.id);
        docs.refetch();
      } finally {
        setUploading(false);
      }
    },
    // docs.refetch / flashSaved are stable; client is the real dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  );

  const addDoc = (kind: KnowledgeKind) => {
    if (kind === 'file') {
      // Open the OS file picker — the drop zone and this button share the path.
      fileInputRef.current?.click();
      return;
    }
    const seed: Record<Exclude<KnowledgeKind, 'file'>, { title: string }> = {
      company: { title: 'New company note' },
      rules: { title: 'New house rule' },
      faq: { title: 'New question' },
    };
    void client
      .createKnowledgeDoc({ kind, title: seed[kind].title, body: '' })
      .then((created) => {
        flashSaved();
        setSelectedId(created.id);
        docs.refetch();
      });
  };

  const saveDoc = (id: string, patch: { title?: string; body?: string }) => {
    void client.updateKnowledgeDoc(id, patch).then(() => {
      flashSaved();
      docs.refetch();
    });
  };

  const deleteDoc = (id: string) => {
    void client.deleteKnowledgeDoc(id).then(() => {
      if (selectedId === id) setSelectedId(null);
      docs.refetch();
    });
  };

  if (list === undefined) return <KnowledgeSkeleton />;

  return (
    <div className={styles.wrap}>
      <p className={styles.caption}>{CAPTION}</p>
      <div className={styles.card}>
        {/* Left column — doc cards grouped by kind. */}
        <div className={styles.list}>
          {GROUPS.map((group) => {
            const groupDocs = list.filter((d) => d.kind === group.kind);
            const isFileGroup = group.kind === 'file';
            // The Files group is a real drop zone: highlight on dragover (hairline
            // accent), accept a drop or an Escape to cancel, and label for AT.
            const dropProps = isFileGroup
              ? {
                  onDragOver: (e: React.DragEvent) => {
                    e.preventDefault();
                    if (!dragOver) setDragOver(true);
                  },
                  onDragLeave: (e: React.DragEvent) => {
                    // Only clear when leaving the section, not its children.
                    if (e.currentTarget === e.target) setDragOver(false);
                  },
                  onDrop: (e: React.DragEvent) => {
                    e.preventDefault();
                    setDragOver(false);
                    const files = Array.from(e.dataTransfer?.files ?? []);
                    void uploadFiles(files);
                  },
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Escape' && dragOver) setDragOver(false);
                  },
                  'aria-label': 'Files — drop files here to teach your agent',
                }
              : {};
            return (
              <section
                key={group.kind}
                className={`${styles.group} ${
                  isFileGroup && dragOver ? styles.groupDropActive : ''
                }`}
                {...dropProps}
              >
                <div className={styles.groupHead}>
                  <span className={styles.groupLabel}>{group.label}</span>
                  <button
                    type="button"
                    className={styles.addBtn}
                    onClick={() => addDoc(group.kind)}
                    disabled={isFileGroup && uploading}
                  >
                    <PlusGlyph />
                    {isFileGroup ? (uploading ? 'Uploading…' : 'Add file') : 'Add'}
                  </button>
                </div>
                {isFileGroup && (
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className={styles.fileInputHidden}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      void uploadFiles(files);
                      e.target.value = ''; // allow re-picking the same file
                    }}
                    aria-hidden="true"
                    tabIndex={-1}
                  />
                )}
                {groupDocs.length === 0 ? (
                  <p className={styles.groupEmpty}>{group.empty}</p>
                ) : (
                  groupDocs.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`${styles.docCard} ${
                        d.id === selectedId ? styles.docCardActive : ''
                      }`}
                      onClick={() => setSelectedId(d.id)}
                    >
                      <span className={styles.docTitle}>{d.title}</span>
                      <span className={styles.docPreview}>
                        {d.kind === 'file' ? (
                          d.body === BINARY_NOTE ? (
                            <span className={styles.platformNote}>
                              Parsed on the platform connection
                            </span>
                          ) : (
                            <>
                              <span className={styles.indexedTag}>Read in</span>
                              {oneLine(d.body)}
                            </>
                          )
                        ) : (
                          oneLine(d.body)
                        )}
                      </span>
                      <span className={`${styles.docUpdated} tnum`}>
                        {formatUpdated(d.updated_at)}
                      </span>
                    </button>
                  ))
                )}
              </section>
            );
          })}
        </div>

        {/* Right column — the inline editor for the selected doc. */}
        <div className={styles.editorPane}>
          {selected ? (
            <DocEditor
              key={selected.id}
              doc={selected}
              onSave={(patch) => saveDoc(selected.id, patch)}
              onDelete={() => deleteDoc(selected.id)}
            />
          ) : (
            <div className={styles.noSelection}>
              <p>Select a document to edit, or add one to teach your agent something new.</p>
            </div>
          )}
        </div>
      </div>
      <span className={`${styles.wisp} ${saved ? styles.wispOn : ''}`} aria-live="polite">
        {saved ? 'Saved' : ''}
      </span>
    </div>
  );
}
