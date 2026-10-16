self.CFB_TOOL_DEFINITIONS = [
  {
    "name": "get_config",
    "description": "Report scope and efficient batch protocol once per task; no system paths or secrets.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    }
  },
  {
    "name": "get_saved_file_status",
    "description": "Read the last verified automatic-save receipt for one scoped path; no file body or current checksum. Path-indexed verified receipts; not_found is unknown, not proof of failed saving.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        }
      },
      "required": [
        "path"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "get_operation_status",
    "description": "Query a previous operationId after timeout/disconnect; never blindly replay pending or unknown operations.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "operationId": {
          "type": "string"
        }
      },
      "required": [
        "operationId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "list_directory",
    "description": "List bounded names; default depth1 and100 items. depth2-20 shows relative nested names; paginate nextOffset.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "depth": {
          "type": "integer"
        },
        "offset": {
          "type": "integer"
        },
        "length": {
          "type": "integer"
        }
      },
      "required": [],
      "additionalProperties": false
    }
  },
  {
    "name": "read_file",
    "description": "Read bounded UTF-8 excerpts up to1 GiB, image preview, or Office part text; structure_only=true lists Office sections without body; never dump a whole folder. PNG/JPEG <=64 MiB auto-preview, image_region selects pixel detail. if_sha256 skips unchanged content. PDF/legacy Office via attachment.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "structure_only": {
          "type": "boolean"
        },
        "offset": {
          "type": "integer"
        },
        "length": {
          "type": "integer"
        },
        "max_chars": {
          "type": "integer"
        },
        "char_offset": {
          "type": "integer"
        },
        "part": {
          "type": "string"
        },
        "page": {
          "type": "integer"
        },
        "sheet": {
          "type": "string"
        },
        "if_sha256": {
          "type": "string"
        },
        "max_dimension": {
          "type": "integer"
        },
        "image_region": {
          "type": "object",
          "properties": {
            "x": {
              "type": "integer"
            },
            "y": {
              "type": "integer"
            },
            "width": {
              "type": "integer"
            },
            "height": {
              "type": "integer"
            }
          },
          "required": [
            "x",
            "y",
            "width",
            "height"
          ],
          "additionalProperties": false
        },
        "isUrl": {
          "type": "boolean",
          "default": false
        }
      },
      "required": [
        "path"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "read_multiple_files",
    "description": "Read excerpts of up to8 UTF-8 files; total text <=16000 chars and source <=64 MiB. Do not request a whole folder.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 8
        }
      },
      "required": [
        "paths"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "describe_files",
    "description": "Inspect metadata and support for up to32 selected files without reading their bodies or hashing.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 32
        }
      },
      "required": [
        "paths"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "get_file_info",
    "description": "Metadata without content; checksum=true streams a file baseline without a size cap; history=true lists recent text backups.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "checksum": {
          "type": "boolean"
        },
        "history": {
          "type": "boolean"
        }
      },
      "required": [
        "path"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "write_file",
    "description": "Chat append without operation_id deduplicates identical arguments for10 minutes within the same page; to append identical text again intentionally, supply a different operation_id. Write complete UTF-8 text in one call up to 4 MiB; no 30-line chunking. Returns cumulative bytes, total_lines, modified and locally verified checksum; do not read back merely to verify. expected_sha256 guards the old file; expected_output_sha256/expected_bytes check the final UTF-8 result before writing. Read existing files first or pass expected_sha256. The reserved .claude-file-operation.json path accepts the deletion protocol from get_config; it never creates a control file.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "content": {
          "type": "string"
        },
        "mode": {
          "type": "string",
          "enum": [
            "rewrite",
            "append"
          ],
          "default": "rewrite"
        },
        "expected_sha256": {
          "type": "string"
        },
        "expected_output_sha256": {
          "type": "string"
        },
        "expected_bytes": {
          "type": "integer"
        },
        "operation_id": {
          "type": "string"
        }
      },
      "required": [
        "path",
        "content"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "edit_block",
    "description": "Replace one exact unique text block. Read the file before editing. Returns replacements count and locally verified receipt, not file body. No fuzzy matching.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "file_path": {
          "type": "string"
        },
        "old_string": {
          "type": "string"
        },
        "new_string": {
          "type": "string"
        },
        "expected_sha256": {
          "type": "string"
        },
        "operation_id": {
          "type": "string"
        }
      },
      "required": [
        "file_path",
        "old_string",
        "new_string"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "edit_blocks",
    "description": "Apply up to 128 exact nonoverlapping text replacements atomically. All checks precede writing; local verification and recovery backup, no full readback.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "edits": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "old_string": {
                "type": "string"
              },
              "new_string": {
                "type": "string"
              }
            },
            "required": [
              "old_string",
              "new_string"
            ],
            "additionalProperties": false
          },
          "minItems": 1,
          "maxItems": 128
        },
        "expected_sha256": {
          "type": "string"
        },
        "operation_id": {
          "type": "string"
        }
      },
      "required": [
        "path",
        "edits"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "edit_office_text",
    "description": "Word/PPT: change exact text runs in the same file by default; optional output_path explicitly saves a separate copy. Preserve package members; backup and on-disk verification. No layout/pixel/chart editing.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "output_path": {
          "type": "string"
        },
        "expected_sha256": {
          "type": "string"
        },
        "edits": {
          "type": "array",
          "maxItems": 128,
          "items": {
            "type": "object",
            "properties": {
              "part": {
                "type": "string"
              },
              "index": {
                "type": "integer"
              },
              "old_text": {
                "type": "string"
              },
              "new_text": {
                "type": "string"
              }
            },
            "required": [
              "part",
              "index",
              "old_text",
              "new_text"
            ],
            "additionalProperties": false
          }
        },
        "operation_id": {
          "type": "string"
        }
      },
      "required": [
        "path",
        "expected_sha256",
        "edits"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "copy_file",
    "description": "Stream-copy regular files of any size. Existing target returns conflict choices; keep_both/skip, or replace with expected_destination_sha256 and local backup. Preserve source bytes, locally verified. Large files may hit processing time budget.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "source": {
          "type": "string"
        },
        "destination": {
          "type": "string"
        },
        "expected_sha256": {
          "type": "string"
        },
        "on_conflict": {
          "type": "string",
          "enum": [
            "ask",
            "keep_both",
            "replace",
            "skip"
          ]
        },
        "expected_destination_sha256": {
          "type": "string"
        },
        "operation_id": {
          "type": "string"
        }
      },
      "required": [
        "source",
        "destination"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "restore_file",
    "description": "Restore a text modification by its backupId. Refuses if the current file changed since that edit; backs up current content for redo.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "backupId": {
          "type": "string"
        },
        "operation_id": {
          "type": "string"
        }
      },
      "required": [
        "path",
        "backupId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "create_directory",
    "description": "Create directories inside the authorized folder.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "operation_id": {
          "type": "string"
        }
      },
      "required": [
        "path"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "move_file",
    "description": "Move a file or folder inside the authorized folder with explicit same-name choices; replacement needs destination checksum and recovery backup. For files, provide expected_sha256 or establish an unchanged baseline with get_file_info; no full-content read is required for metadata-only movement. Directories cannot contain links.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "source": {
          "type": "string"
        },
        "destination": {
          "type": "string"
        },
        "expected_sha256": {
          "type": "string"
        },
        "on_conflict": {
          "type": "string",
          "enum": [
            "ask",
            "keep_both",
            "replace",
            "skip"
          ]
        },
        "expected_destination_sha256": {
          "type": "string"
        },
        "operation_id": {
          "type": "string"
        }
      },
      "required": [
        "source",
        "destination"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "delete_file",
    "description": "Move a regular file to system Trash by default. Permanent deletion requires explicit user intent and both permanent=true and confirmPermanentDelete=true. Trash failure never becomes permanent deletion.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "permanent": {
          "type": "boolean",
          "default": false
        },
        "confirmPermanentDelete": {
          "type": "boolean",
          "default": false
        },
        "operation_id": {
          "type": "string"
        }
      },
      "required": [
        "path"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "delete_directory",
    "description": "Move a directory to system Trash by default; nonempty directories require recursive=true. Root and links are refused. Permanent deletion requires explicit user intent and both permanent=true and confirmPermanentDelete=true.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "permanent": {
          "type": "boolean",
          "default": false
        },
        "confirmPermanentDelete": {
          "type": "boolean",
          "default": false
        },
        "recursive": {
          "type": "boolean",
          "default": false
        },
        "operation_id": {
          "type": "string"
        }
      },
      "required": [
        "path"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "batch_operations",
    "description": "Execute 1-64 mutations or metadata checks in order. Stops on first failure; completed items stay applied. Do not retry the whole batch. Total arguments <=4 MiB; no nested batches. Read text separately with excerpts or read_multiple_files.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "on_conflict": {
          "type": "string",
          "enum": [
            "ask",
            "keep_both",
            "replace",
            "skip"
          ]
        },
        "operations": {
          "type": "array",
          "minItems": 1,
          "maxItems": 64,
          "items": {
            "type": "object",
            "properties": {
              "tool": {
                "type": "string"
              },
              "args": {
                "type": "object"
              }
            },
            "required": [
              "tool",
              "args"
            ],
            "additionalProperties": false
          }
        },
        "operation_id": {
          "type": "string"
        }
      },
      "required": [
        "operations"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "search_files",
    "description": "Find names by keyword; filePattern supports * and ?, ignoreCase is optional. Bounded matches, no links.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "pattern": {
          "type": "string"
        },
        "filePattern": {
          "type": "string"
        },
        "ignoreCase": {
          "type": "boolean"
        }
      },
      "required": [
        "pattern"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "grep_files",
    "description": "Search text or one file by keyword; filePattern narrows types and ignoreCase matches casing variants. Bounded snippets, no links.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "pattern": {
          "type": "string"
        },
        "filePattern": {
          "type": "string"
        },
        "ignoreCase": {
          "type": "boolean"
        }
      },
      "required": [
        "pattern"
      ],
      "additionalProperties": false
    }
  }
];
