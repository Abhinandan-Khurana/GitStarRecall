import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

type SafeMarkdownProps = {
  content: string;
  className?: string;
};

export default function SafeMarkdown({ content, className }: Readonly<SafeMarkdownProps>) {
  return (
    <div className={className ?? "text-foreground [&_*]:text-inherit"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
