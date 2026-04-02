class SchemaCollector {
  private schemas: Record<string, unknown> = {};

  collect(schemas: Record<string, unknown>, source: string): void {
    for (const [key, value] of Object.entries(schemas)) {
      if (this.schemas[key]) {
        throw new Error(
          `Schema table "${key}" already registered. Original source: ${source}, Duplicate from source: ${source}`,
        );
      }
      this.schemas[key] = value;
    }
  }

  getAll(): Record<string, unknown> {
    return { ...this.schemas };
  }

  clear(): void {
    this.schemas = {};
  }
}

export { SchemaCollector };