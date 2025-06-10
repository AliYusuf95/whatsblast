import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  createEditor,
  Editor,
  Element as SlateElement,
  Transforms,
  Range,
  Node,
  type BaseRange,
  type BaseEditor,
} from 'slate';
import { Slate, Editable, withReact, ReactEditor } from 'slate-react';
import { withHistory } from 'slate-history';
import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { createPortal } from 'react-dom';

type Column = {
  index: number;
  name: string;
};

type CustomElement = {
  type: 'paragraph' | 'mention';
  index?: number;
  children: CustomText[];
};

type CustomText =
  | {
      text: string;
      type?: never;
      index?: never;
      children?: never;
    }
  | {
      text: string;
      type: 'mention';
      index: number;
      children: {
        text: string;
      }[];
    };

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}

type MessageEditorProps = {
  columns: Column[];
  value: (string | number)[];
  onChange: (value: (string | number)[]) => void;
};

const initialValue: CustomElement[] = [
  {
    type: 'paragraph',
    children: [{ text: '' }],
  },
];

const withMentions = (editor: Editor) => {
  const { isInline, isVoid } = editor;

  editor.isInline = (element) => {
    return element.type === 'mention' ? true : isInline(element);
  };

  editor.isVoid = (element) => {
    return element.type === 'mention' ? true : isVoid(element);
  };

  return editor;
};

export function MessageEditor({ columns, value, onChange }: MessageEditorProps) {
  const [editor] = useState(() => withMentions(withHistory(withReact(createEditor()))));
  const [target, setTarget] = useState<BaseRange | null>(null);
  const [search, setSearch] = useState('');
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const renderElement = useCallback(
    ({ attributes, children, element }: any) => {
      if (element.type === 'mention') {
        return (
          <Badge {...attributes} variant="default" className="mx-1" contentEditable={false}>
            {columns[element.index!]?.name}
          </Badge>
        );
      }
      return <p {...attributes}>{children}</p>;
    },
    [columns],
  );

  const renderLeaf = useCallback(({ attributes, children }: any) => {
    return <span {...attributes}>{children}</span>;
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (target) {
        switch (event.key) {
          case 'ArrowDown':
            event.preventDefault();
            setIndex((i) => (i + 1) % columns.length);
            return;
          case 'ArrowUp':
            event.preventDefault();
            setIndex((i) => (i - 1 + columns.length) % columns.length);
            return;
          case 'Tab':
          case 'Enter':
            event.preventDefault();
            Transforms.select(editor, target);
            insertMention(editor, filteredColumns[index]);
            setTarget(null);
            return;
          case 'Escape':
            event.preventDefault();
            setTarget(null);
            return;
        }
      }

      if (event.key === '@') {
        const { selection } = editor;
        if (selection) {
          const [start] = Range.edges(selection);
          const wordBefore = Editor.before(editor, start, { unit: 'word' });
          const before = wordBefore && Editor.before(editor, wordBefore);
          const beforeRange = before && Editor.range(editor, before, start);
          const beforeText = beforeRange && Editor.string(editor, beforeRange);
          const beforeMatch = beforeText && beforeText.match(/^@$/);
          const after = Editor.after(editor, start);
          const afterRange = Editor.range(editor, start, after);
          const afterText = Editor.string(editor, afterRange);
          const afterMatch = afterText.match(/^(\s|$)/);

          if (beforeMatch && afterMatch) {
            setTarget(beforeRange);
            setSearch('');
            setIndex(0);
            return;
          }
        }
      }
    },
    [editor, target, columns, index],
  );

  const insertMention = useCallback((editor: Editor, column: Column) => {
    const mention: CustomElement = {
      type: 'mention',
      index: column.index,
      children: [{ text: '' }],
    };
    Transforms.insertNodes(editor, mention);
    Transforms.move(editor);
  }, []);

  const filteredColumns = useMemo(() => {
    return columns.filter((column) => column.name.toLowerCase().includes(search.toLowerCase()));
  }, [columns, search]);

  const serialize = useCallback((nodes: CustomElement[]): (string | number)[] => {
    const result: (string | number)[] = [];
    nodes.forEach((node) => {
      node.children.forEach((child) => {
        if (child.type === 'mention' && typeof child.index === 'number') {
          result.push(child.index);
        }
        if (typeof child.text === 'string') {
          result.push(child.text);
        }
      });
      result.push('\n'); // Add a newline after each node
    });
    // Remove the last newline if it exists
    if (result.length && result[result.length - 1] === '\n') {
      result.pop();
    }
    return result;
  }, []);

  const deserialize = useCallback((value: (string | number)[]): CustomElement[] => {
    if (!value.length) {
      return [
        {
          type: 'paragraph',
          children: [{ text: '' }],
        },
      ];
    }

    const children: CustomText[] = [];

    value.forEach((part) => {
      if (typeof part === 'number') {
        children.push({
          type: 'mention',
          index: part,
          children: [{ text: '' }],
        } as unknown as CustomText);
      } else {
        children.push({ text: part });
      }
    });

    return [
      {
        type: 'paragraph',
        children: children.length ? children : [{ text: '' }],
      },
    ];
  }, []);

  const handleEditorChange = useCallback(
    (newValue: CustomElement[]) => {
      const { selection } = editor;

      if (selection && Range.isCollapsed(selection)) {
        const [start] = Range.edges(selection);
        const wordBefore = Editor.before(editor, start, { unit: 'word' });
        const before = wordBefore && Editor.before(editor, wordBefore);
        const beforeRange = before && Editor.range(editor, before, start);
        const beforeText = beforeRange && Editor.string(editor, beforeRange);
        const beforeMatch = beforeText && beforeText.match(/^@(\w*)$/);

        if (beforeMatch) {
          setTarget(beforeRange);
          setSearch(beforeMatch[1]);
          setIndex(0);
          return;
        }
      }

      setTarget(null);
      onChange(serialize(newValue));
    },
    [editor, onChange, serialize],
  );

  useEffect(() => {
    if (target && ref.current) {
      const el = ref.current;
      const domRange = ReactEditor.toDOMRange(editor, target);
      const rect = domRange.getBoundingClientRect();
      el.style.top = `${rect.top + window.scrollY + 24}px`;
      el.style.left = `${rect.left + window.scrollX}px`;
    }
  }, [editor, index, search, target]);

  return (
    <Slate editor={editor} initialValue={deserialize(value)} onChange={handleEditorChange}>
      <Editable
        renderElement={renderElement}
        renderLeaf={renderLeaf}
        onKeyDown={onKeyDown}
        placeholder="Type @ to insert a column..."
        className="p-2 border rounded bg-accent"
        style={{
          minHeight: '100px',
        }}
        renderPlaceholder={({ attributes, children }) => (
          <span
            {...attributes}
            style={{
              position: 'absolute',
              pointerEvents: 'none',
              width: '100%',
              maxWidth: '100%',
              display: 'block',
              opacity: 0.333,
              userSelect: 'none',
              textDecoration: 'none',
            }}
          >
            {children}
          </span>
        )}
      />
      {target && (
        <div
          ref={ref}
          style={{
            top: '-9999px',
            left: '-9999px',
            position: 'absolute',
            zIndex: 1,
            padding: '3px',
            background: 'white',
            borderRadius: '4px',
            boxShadow: '0 1px 5px rgba(0,0,0,.2)',
          }}
        >
          <Command className="rounded-lg border shadow-md">
            <CommandInput
              placeholder="Search columns..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No columns found.</CommandEmpty>
              <CommandGroup>
                {filteredColumns.map((column, i) => (
                  <CommandItem
                    key={i}
                    onSelect={() => {
                      insertMention(editor, column);
                      setTarget(null);
                    }}
                    autoFocus={false}
                    className={i === index ? 'bg-accent' : ''}
                  >
                    <p className="hidden">{index}</p>
                    {column.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      )}
    </Slate>
  );
}
