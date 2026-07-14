import { visit } from "jsonc-parser";

export const findDuplicateJsonProperty = (json: string): string | undefined => {
  const objectProperties: Array<Set<string>> = [];
  let duplicate: string | undefined;

  visit(
    json,
    {
      onObjectBegin: () => {
        objectProperties.push(new Set());
      },
      onObjectProperty: (property) => {
        const properties = objectProperties.at(-1);
        if (properties?.has(property)) {
          duplicate ??= property;
          return;
        }

        properties?.add(property);
      },
      onObjectEnd: () => {
        objectProperties.pop();
      },
    },
    {
      allowEmptyContent: false,
      allowTrailingComma: false,
      disallowComments: true,
    },
  );

  return duplicate;
};
