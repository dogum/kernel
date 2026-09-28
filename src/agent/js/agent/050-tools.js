/* ── tool definitions ── */
const AG_TOOLS = [
  {
    name: "add_cells",
    description:
      "Add one or more cells to the notebook in order (markdown for framing, code for the step). With run:true the new code cells execute in order in the same call (stopping at the first error) and their outputs, tracebacks, and figures come back — prefer it, it saves a round trip. Without run the cells are only staged.",
    input_schema: {
      type: "object",
      properties: {
        cells: {
          type: "array",
          items: {
            type: "object",
            properties: { type: { type: "string", enum: ["markdown", "code"] }, source: { type: "string" } },
            required: ["type", "source"],
          },
        },
        after_cell_id: { type: "string", description: "insert after this cell id; omit to append at the end" },
        run: { type: "boolean", description: "run the new code cells immediately and return their outputs" },
      },
      required: ["cells"],
    },
  },
  {
    name: "run_cell",
    description:
      "Execute one code cell and return its outputs (text, tables, tracebacks, and figures as images you can see).",
    input_schema: { type: "object", properties: { cell_id: { type: "string" } }, required: ["cell_id"] },
  },
  {
    name: "run_all",
    description:
      "Run all code cells from the top (or from a given cell). Stops at the first error. Returns per-cell summaries plus full output for the final and any errored cell.",
    input_schema: { type: "object", properties: { from_cell_id: { type: "string" } } },
  },
  {
    name: "edit_cell",
    description:
      "Replace a cell source. With run:true a code cell reruns in the same call and its outputs come back — the usual way to fix a traceback.",
    input_schema: {
      type: "object",
      properties: {
        cell_id: { type: "string" },
        source: { type: "string" },
        run: { type: "boolean", description: "rerun the edited code cell immediately and return its outputs" },
      },
      required: ["cell_id", "source"],
    },
  },
  {
    name: "read_cell",
    description: "Re-read a cell current source and outputs without re-running it.",
    input_schema: { type: "object", properties: { cell_id: { type: "string" } }, required: ["cell_id"] },
  },
  {
    name: "inspect_namespace",
    description: "List the live variables in the kernel (name, type, info, size).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "inspect_variable",
    description:
      "Look closely at one variable: DataFrame head and dtypes, Series stats, array shape/min/max/mean, dict/list samples, scalar repr.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "list_data_files",
    description: "List the data files mounted into the kernel working directory (name, type, size, short preview).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_data_file",
    description:
      "Read a bounded text chunk from a mounted artifact by stable path. Large files stay in the workspace; use offset and limit (in characters) to page through them.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" } },
      required: ["path"],
    },
  },
  {
    name: "save_data_file",
    description:
      "Register a file in the artifact workspace. If content is given, write it first; otherwise the path must already exist. Results default to working/scratch until explicitly promoted final.",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        content: { type: "string" },
        lifecycle: { type: "string", enum: ["scratch", "final"] },
        source_cell_id: { type: "string" },
      },
      required: ["filename"],
    },
  },
  {
    name: "set_artifact_stage",
    description: "Promote a working artifact to final or move a final artifact back to working.",
    input_schema: {
      type: "object",
      properties: { artifact_id: { type: "string" }, stage: { type: "string", enum: ["scratch", "final"] } },
      required: ["artifact_id", "stage"],
    },
  },
  {
    name: "update_plan",
    description:
      "Publish or update the visible execution plan for multi-step work. This is progress metadata, not hidden reasoning.",
    input_schema: {
      type: "object",
      properties: {
        explanation: { type: "string" },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] },
            },
            required: ["id", "title", "status"],
          },
        },
      },
      required: ["steps"],
    },
  },
  {
    name: "finish_run",
    description:
      "Request successful completion after all promised work is actually done. KERNEL rejects this while any visible plan step is pending or in progress. Supply concise claims tied to stable IDs for fresh executed cells or present artifacts; KERNEL validates every reference. After acceptance, return the final user-facing summary without more tools.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        evidence: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["cell", "artifact"] },
              id: { type: "string" },
              claim: { type: "string" },
            },
            required: ["kind", "id", "claim"],
          },
        },
        limitations: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "evidence"],
    },
  },
  {
    name: "set_notebook_name",
    description: 'Name (or rename) the notebook once the topic is clear, e.g. "berry-cluster-analysis".',
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "delete_cell",
    description: "Delete a cell.",
    input_schema: { type: "object", properties: { cell_id: { type: "string" } }, required: ["cell_id"] },
  },
  {
    name: "move_cell",
    description: "Move a cell to a new index.",
    input_schema: {
      type: "object",
      properties: { cell_id: { type: "string" }, to_index: { type: "integer" } },
      required: ["cell_id", "to_index"],
    },
  },
];
