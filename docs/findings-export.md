# Findings export

A lead triaging a week of reviews wants one file, not twelve browser tabs.
`GET /repos/:id/findings/export` flattens every finding of a repo into a
spreadsheet.

## Endpoint

```
GET /repos/:id/findings/export?format=csv|xlsx&severity=&orderBy=&label=
```

| Query | Meaning | Default |
|---|---|---|
| `format` | `csv` or `xlsx` | `csv` |
| `severity` | keep only findings of that severity | all |
| `orderBy` | column the rows are sorted by, descending | `created_at` |
| `label` | goes into the downloaded file's name | the repo id |

The response is a download: `content-type` follows the format and
`content-disposition` carries `findings-<label>.<format>`.

## Columns

`pull`, `file`, `line`, `severity`, `agent`, `title`, `detail` — one row per
finding, joined to the pull it belongs to and the agent that raised it.

## Shape

| File | What it does |
|---|---|
| `routes.ts` | the HTTP edge — query parsing, headers, the download |
| `service.ts` | picks the format, builds the workbook, records the activity line |
| `repository.ts` | the flattening join across `findings → reviews → pulls → agents` |
| `helpers.ts` | pure CSV and sheet-row formatting |

XLSX is produced with `exceljs`, which is why this change touches
`package.json` and the lockfile.

## Not covered yet

- No pagination — a repo's whole finding history comes back in one response.
- No scheduled or emailed export; this is a pull, not a push.
- The activity line is best-effort and does not fail the download.
