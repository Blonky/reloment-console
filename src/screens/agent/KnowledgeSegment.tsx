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

const GROUPS: { kind: KnowledgeKind; label: string; empty: string }[] = [
  { kind: 'company', label: 'Company', empty: 'Nothing here yet — the agent works from your book alone.' },
  { kind: 'rules', label: 'House rules', empty: 'Nothing here yet — the agent works from your book alone.' },
  { kind: 'faq', label: 'FAQs', empty: 'Nothing here yet — the agent works from your book alone.' },
  { kind: 'file', label: 'Files', empty: 'No files indexed yet.' },
];

// A demo "Add file" affordance — records a filename + size (no real upload). The
// entries cycle so repeated adds are distinct and deterministic.
const DEMO_FILES: { filename: string; size_bytes: number }[] = [
  { filename: 'Auto-coverage-guide.pdf', size_bytes: 412_880 },
  { filename: 'Home-endorsements.pdf', size_bytes: 298_140 },
  { filename: 'Carrier-appetite-2026.xlsx', size_bytes: 76_400 },
];

const WISP_MS = 1600;

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
          <span className={styles.indexedPill}>Indexed</span>
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
  const wispTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileSeq = useRef(0);

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

  const list = docs.data;

  const selected = list?.find((d) => d.id === selectedId) ?? null;

  const addDoc = (kind: KnowledgeKind) => {
    if (kind === 'file') {
      const pick = DEMO_FILES[fileSeq.current % DEMO_FILES.length];
      fileSeq.current += 1;
      void client
        .createKnowledgeDoc({
          kind: 'file',
          title: pick.filename,
          body: '',
          filename: pick.filename,
          size_bytes: pick.size_bytes,
        })
        .then((created) => {
          flashSaved();
          setSelectedId(created.id);
          docs.refetch();
        });
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
            return (
              <section key={group.kind} className={styles.group}>
                <div className={styles.groupHead}>
                  <span className={styles.groupLabel}>{group.label}</span>
                  <button
                    type="button"
                    className={styles.addBtn}
                    onClick={() => addDoc(group.kind)}
                  >
                    <PlusGlyph />
                    {group.kind === 'file' ? 'Add file' : 'Add'}
                  </button>
                </div>
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
                          <>
                            <span className={styles.indexedTag}>Indexed</span>
                            {d.filename}
                          </>
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
