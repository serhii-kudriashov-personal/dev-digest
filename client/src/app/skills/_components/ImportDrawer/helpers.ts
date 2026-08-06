/** Accepted upload extensions — mirrors the server's `parseSkillUpload`. */
export const ACCEPTED_EXTENSIONS = ".md,.markdown,.zip";

/**
 * Read a picked file as base64 for `POST /skills/import`.
 *
 * `FileReader.readAsDataURL` gives `data:<mime>;base64,<payload>`; only the
 * payload is sent. Chunking through `btoa` by hand would blow the call stack on
 * a large archive, which is why the reader is used instead.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma === -1) {
        reject(new Error(`Could not decode ${file.name}`));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}
