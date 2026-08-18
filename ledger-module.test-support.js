const defaultCategoryNames = ['飲食', '娛樂', '醫療', '交通', '生活', '訂閱'];

export class InMemoryLedgerAdapter {
  constructor() {
    this.ledgersByOwner = new Map();
    this.nextLedgerId = 1;
  }

  async findPersonalLedger(userId) {
    return this.ledgersByOwner.get(userId) ?? null;
  }

  async createPersonalLedger({ ownerId, displayName }) {
    const existingLedger = this.ledgersByOwner.get(ownerId);
    if (existingLedger) {
      return existingLedger;
    }

    const ledger = {
      id: `ledger-${this.nextLedgerId++}`,
      ownerId,
      name: displayName ? `${displayName}的帳本` : '我的帳本',
      members: [{ userId: ownerId, role: 'owner' }],
      categories: defaultCategoryNames.map((categoryName, index) => ({
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

