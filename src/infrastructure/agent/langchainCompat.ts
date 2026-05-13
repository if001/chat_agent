type UuidModule = {
  v4?: unknown;
};

type UuidObjectWithDefault = {
  default?: unknown;
};

export const patchLangChainUuidV4 = (): void => {
  const uuidModule = require("@langchain/core/utils/uuid") as UuidModule;
  if (typeof uuidModule.v4 === "function") {
    return;
  }

  const candidate = (uuidModule.v4 as UuidObjectWithDefault | undefined)
    ?.default;
  if (typeof candidate === "function") {
    uuidModule.v4 = candidate;
    process.stdout.write(
      "[compat] patched @langchain/core/utils/uuid.v4 to function\n",
    );
  }
};
