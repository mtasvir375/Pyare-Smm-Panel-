export async function migrateAllFromFirebase(): Promise<{ success: boolean; migrated: Record<string, number>; errors: string[] }> {
  return {
    success: true,
    migrated: {},
    errors: []
  };
}
