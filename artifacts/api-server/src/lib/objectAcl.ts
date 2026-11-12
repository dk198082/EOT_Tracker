const ACL_POLICY_METADATA_KEY = "aclpolicy";

export enum ObjectAccessGroupType {}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

/**
 * Storage adapter contract.
 * AzureObjectFile in objectStorage.ts will implement this interface.
 */
export interface ObjectAclFile {
  name: string;
  exists(): Promise<[boolean]>;
  getMetadata(): Promise<
    [{ metadata?: Record<string, string> }]
  >;
  setMetadata(metadata: {
    metadata: Record<string, string>;
  }): Promise<void>;
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [
      ObjectPermission.READ,
      ObjectPermission.WRITE,
    ].includes(granted);
  }

  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup
  implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}

  public abstract hasMember(userId: string): Promise<boolean>;
}

function createObjectAccessGroup(
  group: ObjectAccessGroup,
): BaseObjectAccessGroup {
  switch (group.type) {
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

export async function setObjectAclPolicy(
  objectFile: ObjectAclFile,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  const [exists] = await objectFile.exists();

  if (!exists) {
    throw new Error(`Object not found: ${objectFile.name}`);
  }

  const [currentMetadata] = await objectFile.getMetadata();

  await objectFile.setMetadata({
    metadata: {
      ...(currentMetadata.metadata ?? {}),
      [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy),
    },
  });
}

export async function getObjectAclPolicy(
  objectFile: ObjectAclFile,
): Promise<ObjectAclPolicy | null> {
  const [metadata] = await objectFile.getMetadata();

  const aclPolicy =
    metadata?.metadata?.[ACL_POLICY_METADATA_KEY];

  if (!aclPolicy) {
    return null;
  }

  return JSON.parse(aclPolicy) as ObjectAclPolicy;
}

export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: ObjectAclFile;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);

  if (!aclPolicy) {
    return false;
  }

  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (aclPolicy.owner === userId) {
    return true;
  }

  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);

    if (
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(
        requestedPermission,
        rule.permission,
      )
    ) {
      return true;
    }
  }

  return false;
}
