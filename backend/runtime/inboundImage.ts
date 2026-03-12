export type InboundImageReference = {
  kind: "image";
  url: string;
  absolute_url?: string | null;
  mime_type?: string | null;
  name?: string | null;
  size_bytes?: number | null;
};
