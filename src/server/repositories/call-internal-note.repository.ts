import { BaseRepository } from "@/server/repositories/base.repository";

export class CallInternalNoteRepository extends BaseRepository {
  listByCallLog(companyId: string, callLogId: string) {
    return this.prisma.callInternalNote.findMany({
      where: { companyId, callLogId },
      orderBy: { createdAt: "desc" },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }

  create(
    companyId: string,
    callLogId: string,
    authorId: string,
    content: string,
  ) {
    return this.prisma.callInternalNote.create({
      data: { companyId, callLogId, authorId, content },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }

  update(companyId: string, id: string, content: string) {
    return this.prisma.callInternalNote.updateMany({
      where: { id, companyId },
      data: { content },
    });
  }

  delete(companyId: string, id: string) {
    return this.prisma.callInternalNote.deleteMany({
      where: { id, companyId },
    });
  }
}
