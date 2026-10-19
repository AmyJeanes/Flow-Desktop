export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard API can be denied in WebView2; fall through to the textarea path.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    try {
      textarea.select();
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  } catch {
    return false;
  }
}

// Opens the system share sheet where there is one, else copies the link.
export async function shareLink(title: string, url: string): Promise<"shared" | "copied" | "failed"> {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch (error) {
      // Closing the share sheet rejects with AbortError, which isn't a failure. Any other
      // rejection means no sheet was shown, so copy the link instead of doing nothing.
      if (error instanceof DOMException && error.name === "AbortError") return "shared";
    }
  }
  return (await copyText(url)) ? "copied" : "failed";
}
