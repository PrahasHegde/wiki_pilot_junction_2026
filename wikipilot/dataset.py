"""Streaming readers for the provided datasets (M: every version; S: today's articles)."""
import glob, os
from datetime import timezone
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from .config import DATA

M_FILES = sorted(glob.glob(os.path.join(DATA, "m", "versions-*.parquet")))
META = ["page_id", "title", "rev_id", "parent_id", "timestamp", "user", "anonymous", "comment",
        "minor", "sha1", "bytes"]


def page_sizes():
    """{page_id: (title, versions, total_bytes)} from metadata only — a few seconds."""
    out = {}
    for f in M_FILES:
        t = pq.read_table(f, columns=["page_id", "title", "bytes"])
        for pid, ti, b in zip(t["page_id"].to_pylist(), t["title"].to_pylist(), t["bytes"].to_pylist()):
            _, n, s = out.get(pid, (ti, 0, 0))
            out[pid] = (ti, n + 1, s + (b or 0))
    return out


def iter_pages(columns, only=None, with_text=None, files=None):
    """Yield (page_id, [row dicts oldest first]) for every page in the M files.

    only:      a set of page_ids to keep (others skipped before converting to Python).
    with_text: a set of page_ids whose `text` column is kept; for the rest text is None.
    """
    for f in files or M_FILES:
        pf = pq.ParquetFile(f)
        pending, pending_id = [], None
        for g in range(pf.num_row_groups):
            t = pf.read_row_group(g, columns=columns)
            if only is not None:
                t = t.filter(pc.is_in(t["page_id"], value_set=pa.array(sorted(only), pa.uint32())))
                if t.num_rows == 0:
                    continue
            if with_text is not None and "text" in columns:
                keep = pc.is_in(t["page_id"], value_set=pa.array(sorted(with_text) or [0], pa.uint32()))
                t = t.set_column(t.column_names.index("text"), "text",
                                 pc.if_else(keep, t["text"], pa.scalar(None, pa.string())))
            for r in t.to_pylist():
                ts = r.get("timestamp")
                if ts is not None:
                    r["timestamp"] = ts.astimezone(timezone.utc).replace(tzinfo=None)
                if r["page_id"] != pending_id:
                    if pending:
                        yield pending_id, sorted(pending, key=lambda x: (x["timestamp"], x["rev_id"]))
                    pending, pending_id = [], r["page_id"]
                pending.append(r)
        if pending:
            yield pending_id, sorted(pending, key=lambda x: (x["timestamp"], x["rev_id"]))
