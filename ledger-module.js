export const DEFAULT_CATEGORY_NAMES = [
  '飲食',
  '娛樂',
  '醫療',
  '交通',
  '生活',
  '訂閱',
];

export class LedgerModule {
  constructor(adapter) {
    this.adapter = adapter;
  }

  async provisionPersonalLedger({ userId, displayName }) {
    if (!userId) {
      throw new Error('必須提供使用者識別。');
    }

    const existingLedger = await this.adapter.findPersonalLedger(userId);
    if (existingLedger) {
      return existingLedger;
    }

    return this.adapter.createPersonalLedger({
      ownerId: userId,
      name: displayName ? `${displayName}的帳本` : '我的帳本',
      categoryNames: DEFAULT_CATEGORY_NAMES,
    });
  }
}

export class InMemoryLedgerAdapter {
  constructor() {
    this.ledgersByOwner = new Map();
    this.nextLedgerId = 1;
  }

  async findPersonalLedger(userId) {
    return this.ledgersByOwner.get(userId) ?? null;
  }

  async createPersonalLedger({ ownerId, name, categoryNames }) {
    const existingLedger = this.ledgersByOwner.get(ownerId);
    if (existingLedger) {
      return existingLedger;
    }

    const ledger = {
      id: `ledger-${this.nextLedgerId++}`,
      ownerId,
      name,
      members: [{ userId: ownerId, role: 'owner' }],
      categories: categoryNames.map((categoryName, index) => ({
        id: `category-${index + 1}`,
        name: categoryName,
        retiredAt: null,
      })),
    };

    this.ledgersByOwner.set(ownerId, ledger);
    return ledger;
  }

  countLedgers() {
    return this.ledgersByOwner.size;
  }
}

