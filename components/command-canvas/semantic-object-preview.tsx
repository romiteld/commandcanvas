import type { CanvasObject } from "@/lib/canvas/object-model";

type SemanticObject = Extract<
  CanvasObject,
  { type: "data_table" | "reference_card" | "meeting_card" }
>;

export function SemanticObjectPreview({ object }: { object: SemanticObject }) {
  switch (object.type) {
    case "data_table":
      return (
        <div className="semantic-table-preview">
          <table aria-label={object.title}>
            <thead>
              <tr>
                {object.payload.columns.map((column) => (
                  <th key={column.id} scope="col">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {object.payload.rows.map((row) => (
                <tr key={row.id}>
                  {row.cells.map((cell, index) => (
                    <td key={object.payload.columns[index]?.id ?? index}>
                      {displayCell(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "reference_card":
      return (
        <div className="reference-card-preview">
          <span className="semantic-card-kind">
            {object.payload.kind.replaceAll("_", " ").toUpperCase()}
          </span>
          <p>{object.payload.summary}</p>
          {object.payload.excerpt ? (
            <blockquote>{object.payload.excerpt}</blockquote>
          ) : null}
          {object.payload.sourceUrl ? (
            <small className="reference-source">
              {referenceHost(object.payload.sourceUrl)}
            </small>
          ) : (
            <small className="reference-source">Participant supplied</small>
          )}
        </div>
      );
    case "meeting_card":
      return (
        <div
          className="meeting-card-preview"
          data-meeting-card-kind={object.payload.kind}
        >
          <span className="semantic-card-kind">
            {object.payload.kind.replaceAll("_", " ").toUpperCase()}
          </span>
          <p>{object.payload.body}</p>
          {object.payload.bullets.length > 0 ? (
            <ul>
              {object.payload.bullets.map((bullet, index) => (
                <li key={`${object.id}-bullet-${index}`}>{bullet}</li>
              ))}
            </ul>
          ) : null}
          <span className="meeting-card-metadata">
            {object.payload.owner ? <small>{object.payload.owner}</small> : null}
            {object.payload.dueDate ? (
              <time dateTime={object.payload.dueDate}>{object.payload.dueDate}</time>
            ) : null}
            <small>{object.payload.status.replaceAll("_", " ")}</small>
          </span>
        </div>
      );
  }
}

function displayCell(cell: string | number | boolean | null) {
  if (cell === null) return "—";
  if (typeof cell === "boolean") return cell ? "Yes" : "No";
  return String(cell);
}

function referenceHost(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return "Reference";
  }
}
