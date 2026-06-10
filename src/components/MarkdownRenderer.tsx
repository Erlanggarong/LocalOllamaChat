"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({});

  const handleCopy = async (code: string, key: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedMap((prev) => ({ ...prev, [key]: true }));
      setTimeout(() => setCopiedMap((prev) => ({ ...prev, [key]: false })), 2000);
    } catch {
      // fallback ignored
    }
  };

  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-lg font-bold text-white mb-3 mt-4">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold text-white/90 mb-2 mt-3">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-white/80 mb-2 mt-3">{children}</h3>,
          p: ({ children }) => <p className="mb-2 leading-relaxed text-slate-300">{children}</p>,
          strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
          em: ({ children }) => <em className="text-slate-200 italic">{children}</em>,
          ul: ({ children }) => <ul className="mb-2 space-y-1 ml-4 list-disc marker:text-slate-500">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 space-y-1 ml-4 list-decimal marker:text-slate-500">{children}</ol>,
          li: ({ children }) => <li className="text-slate-300">{children}</li>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-blue-500/50 pl-3 py-1 my-2 bg-white/[0.02] rounded-r-lg">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-white/[0.06] my-3" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-white/[0.04]">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-b border-white/[0.04]">{children}</tr>,
          th: ({ children }) => <th className="text-left px-3 py-2 font-medium text-slate-300">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 text-slate-400">{children}</td>,
          code: ({ children, className, node, ...rest }) => {
            const match = /language-(\w+)/.exec(className || "");
            const lang = match ? match[1] : "text";
            const codeText = String(children).replace(/\n$/, "");
            const copyKey = `${lang}-${codeText.slice(0, 50)}`;
            const isCopied = copiedMap[copyKey];

            if (match) {
              return (
                <div className="my-2 rounded-lg overflow-hidden border border-white/[0.06]">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.03] border-b border-white/[0.06]">
                    <span className="text-[10px] text-slate-500 font-mono uppercase">{lang}</span>
                    <button
                      onClick={() => handleCopy(codeText, copyKey)}
                      className="text-[10px] text-slate-500 hover:text-white transition-colors flex items-center gap-1"
                    >
                      {isCopied ? (
                        <>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Copied
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <SyntaxHighlighter
                    language={lang}
                    style={vscDarkPlus}
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      padding: "12px 16px",
                      fontSize: "11px",
                      lineHeight: "1.6",
                      background: "#0d1117",
                    }}
                    codeTagProps={{ style: { fontFamily: "'JetBrains Mono', monospace" } }}
                  >
                    {codeText}
                  </SyntaxHighlighter>
                </div>
              );
            }
            return (
              <code className="px-1.5 py-0.5 text-[11px] font-mono bg-white/[0.06] text-blue-300 rounded border border-white/[0.06]">
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
