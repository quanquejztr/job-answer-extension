// Vite's `?url` suffix resolves to the built file's URL (used for the pdf.js worker).
declare module '*?url' {
  const url: string;
  export default url;
}
