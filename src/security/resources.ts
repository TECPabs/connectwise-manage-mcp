/**
 * Resource map: which API paths the connector may call, how each record is
 * tied to a company, and exactly which fields may leave the server.
 *
 * This is an allowlist in both directions:
 *  - a path that matches no route is refused (see `matchRoute`);
 *  - a field that is not named in a resource's `fields` is dropped.
 *
 * Field specs:
 *   true        scalar passes through; an object is reduced to a reference
 *               ({id, name, identifier, summary}); arrays are handled per item.
 *   { ... }     nested allowlist, applied to an object or to each array item.
 *
 * Deliberately absent everywhere unless listed: customFields, internal notes
 * and analysis, configuration question answers and network details, member
 * (employee) personal, rate and cost data, license keys and credentials.
 * An operator can add a field with CW_MANAGE_EXTRA_FIELDS, except the ones in
 * NEVER_RETURNED.
 */

export type FieldSpec = true | { readonly [field: string]: FieldSpec };
export type FieldMap = { readonly [field: string]: FieldSpec };

/**
 * How a record relates to the company scope:
 *  company    the record carries a company (enforced on every lookup)
 *  reference  setup, reference and internal stock data with no customer content
 *  unscoped   customer-related data that carries no company reference, so it
 *             cannot be scoped — refused while a company restriction is active
 */
export type ScopeKind = "company" | "reference" | "unscoped";

export interface ResourceDef {
  readonly scope: ScopeKind;
  readonly fields: FieldMap;
  /** Field holding the company reference. Default "company"; "." = the record itself. */
  readonly companyField?: string;
  /** Rows with any of these flags set are internal notes. */
  readonly internalFlags?: readonly string[];
}

/** Fields that no configuration can unlock. */
export const NEVER_RETURNED: ReadonlySet<string> = new Set([
  "password",
  "portalPassword",
  "securityIdentifier",
  "token",
  "apiKey",
  "privateKey",
  "publicKey",
  "ssn",
  "licenseBits",
]);

const INFO: FieldSpec = {
  dateEntered: true,
  lastUpdated: true,
  enteredBy: true,
  updatedBy: true,
};

const TICKET_FIELDS: FieldMap = {
  id: true,
  summary: true,
  recordType: true,
  board: true,
  status: true,
  workRole: true,
  workType: true,
  project: true,
  phase: true,
  wbsCode: true,
  company: true,
  site: true,
  contact: true,
  contactName: true,
  type: true,
  subType: true,
  item: true,
  team: true,
  owner: true,
  priority: true,
  serviceLocation: true,
  source: true,
  severity: true,
  impact: true,
  requiredDate: true,
  budgetHours: true,
  actualHours: true,
  estimatedStartDate: true,
  dueDate: true,
  duration: true,
  closedDate: true,
  closedBy: true,
  closedFlag: true,
  approved: true,
  resources: true,
  parentTicketId: true,
  hasChildTicket: true,
  hasMergedChildTicketFlag: true,
  agreement: true,
  department: true,
  location: true,
  isInSla: true,
  slaStatus: true,
  dateResolved: true,
  dateResplan: true,
  dateResponded: true,
  // Read by cw_create_time_entry to suppress and then restore ticket emails.
  automaticEmailContactFlag: true,
  automaticEmailResourceFlag: true,
  automaticEmailCcFlag: true,
  _info: INFO,
};

const NOTE_FIELDS: FieldMap = {
  id: true,
  ticketId: true,
  ticket: true,
  text: true,
  noteType: true,
  detailDescriptionFlag: true,
  internalAnalysisFlag: true,
  resolutionFlag: true,
  issueFlag: true,
  internalFlag: true,
  externalFlag: true,
  bundledFlag: true,
  mergedFlag: true,
  originalAuthor: true,
  member: true,
  contact: true,
  dateCreated: true,
  createdBy: true,
  timeStart: true,
  timeEnd: true,
  _info: INFO,
};

const REFERENCE_FIELDS: FieldMap = {
  id: true,
  name: true,
  identifier: true,
  description: true,
  inactiveFlag: true,
  defaultFlag: true,
  closedStatus: true,
  closedFlag: true,
  sortOrder: true,
  board: true,
  category: true,
  location: true,
  department: true,
  type: true,
  subType: true,
  typeAssociationIds: true,
  subTypeAssociationIds: true,
  billTime: true,
  hoursMin: true,
  hoursMax: true,
  probability: true,
  holidayList: true,
  date: true,
  timeStart: true,
  timeEnd: true,
  allDayFlag: true,
  chargeCode: true,
  showAsTentativeFlag: true,
  scheduleSpan: true,
  emailFlag: true,
  phoneFlag: true,
  faxFlag: true,
};

const CONFIGURATION_FIELDS: FieldMap = {
  id: true,
  name: true,
  type: true,
  status: true,
  company: true,
  contact: true,
  site: true,
  locationId: true,
  businessUnitId: true,
  deviceIdentifier: true,
  serialNumber: true,
  modelNumber: true,
  tagNumber: true,
  manufacturer: true,
  vendor: true,
  purchaseDate: true,
  installationDate: true,
  warrantyExpirationDate: true,
  osType: true,
  activeFlag: true,
  parentConfigurationId: true,
  _info: INFO,
};

export const RESOURCES: { readonly [name: string]: ResourceDef } = {
  ticket: { scope: "company", fields: TICKET_FIELDS },
  ticketNote: {
    scope: "company",
    fields: NOTE_FIELDS,
    internalFlags: ["internalAnalysisFlag", "internalFlag"],
  },
  ticketTask: {
    scope: "company",
    fields: {
      id: true,
      ticketId: true,
      notes: true,
      closedFlag: true,
      priority: true,
      schedule: true,
      code: true,
      resolution: true,
      _info: INFO,
    },
  },
  project: {
    scope: "company",
    fields: {
      id: true,
      name: true,
      description: true,
      status: true,
      type: true,
      board: true,
      company: true,
      contact: true,
      site: true,
      manager: true,
      department: true,
      location: true,
      estimatedStart: true,
      estimatedEnd: true,
      actualStart: true,
      actualEnd: true,
      actualHours: true,
      budgetHours: true,
      scheduledHours: true,
      percentComplete: true,
      closedFlag: true,
      _info: INFO,
    },
  },
  company: {
    scope: "company",
    companyField: ".",
    fields: {
      id: true,
      identifier: true,
      name: true,
      status: true,
      types: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      zip: true,
      country: true,
      phoneNumber: true,
      website: true,
      territory: true,
      market: true,
      site: true,
      defaultContact: true,
      deletedFlag: true,
      _info: INFO,
    },
  },
  contact: {
    scope: "company",
    fields: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      site: true,
      title: true,
      department: true,
      relationship: true,
      types: true,
      inactiveFlag: true,
      defaultFlag: true,
      communicationItems: {
        id: true,
        type: true,
        value: true,
        extension: true,
        defaultFlag: true,
        communicationType: true,
      },
      _info: INFO,
    },
  },
  configuration: { scope: "company", fields: CONFIGURATION_FIELDS },
  // Configurations attached to a ticket: the ticket decides access, and each
  // row is also checked against its own company.
  ticketConfiguration: {
    scope: "company",
    fields: {
      ...CONFIGURATION_FIELDS,
      // The association list is a set of references; keep the link to the record.
      _info: { ...(INFO as FieldMap), configuration_href: true },
    },
  },
  agreement: {
    scope: "company",
    fields: {
      id: true,
      name: true,
      type: true,
      company: true,
      contact: true,
      site: true,
      parentAgreement: true,
      department: true,
      location: true,
      startDate: true,
      endDate: true,
      noEndingDateFlag: true,
      cancelledFlag: true,
      dateCancelled: true,
      agreementStatus: true,
      applicationUnits: true,
      applicationLimit: true,
      applicationCycle: true,
      coverAgreementTime: true,
      coverAgreementProduct: true,
      coverAgreementExpense: true,
      _info: INFO,
    },
  },
  agreementAddition: {
    scope: "company",
    fields: {
      id: true,
      agreementId: true,
      product: true,
      description: true,
      quantity: true,
      invoiceDescription: true,
      additionStatus: true,
      agreementStatus: true,
      effectiveDate: true,
      cancelledDate: true,
      billCustomer: true,
      lessIncluded: true,
      billedQuantity: true,
      unitPrice: true,
      unitCost: true,
      extPrice: true,
      extCost: true,
      margin: true,
      uom: true,
      taxableFlag: true,
      serialNumber: true,
      _info: INFO,
    },
  },
  agreementRecap: {
    scope: "company",
    fields: {
      id: true,
      name: true,
      agreementName: true,
      type: true,
      company: true,
      contact: true,
      startDate: true,
      endDate: true,
      noEndingDateFlag: true,
      cancelledFlag: true,
      agreementStatus: true,
      applicationUnits: true,
      applicationLimit: true,
      applicationCycle: true,
      billAmount: true,
      startingAmount: true,
      usedAmount: true,
      availableAmount: true,
      overrun: true,
      _info: INFO,
    },
  },
  invoice: {
    scope: "company",
    fields: {
      id: true,
      invoiceNumber: true,
      type: true,
      status: true,
      company: true,
      billToCompany: true,
      date: true,
      dueDate: true,
      subtotal: true,
      salesTax: true,
      total: true,
      payments: true,
      credits: true,
      balance: true,
      serviceTotal: true,
      productTotal: true,
      expenseTotal: true,
      agreementAmount: true,
      downpaymentApplied: true,
      attention: true,
      reference: true,
      customerPO: true,
      billingTerms: true,
      billingSite: true,
      shipToCompany: true,
      shipToSite: true,
      applyToType: true,
      applyToId: true,
      taxCode: true,
      currency: true,
      ticket: true,
      project: true,
      phase: true,
      agreement: true,
      salesOrder: true,
      department: true,
      location: true,
      _info: INFO,
    },
  },
  salesOrder: {
    scope: "company",
    fields: {
      id: true,
      status: true,
      description: true,
      opportunity: true,
      orderDate: true,
      dueDate: true,
      company: true,
      contact: true,
      site: true,
      billToCompany: true,
      billToContact: true,
      billToSite: true,
      shipToCompany: true,
      shipToContact: true,
      shipToSite: true,
      billingTerms: true,
      taxCode: true,
      poNumber: true,
      salesRep: true,
      department: true,
      location: true,
      billClosedFlag: true,
      billShippedFlag: true,
      productIds: true,
      invoiceIds: true,
      subTotal: true,
      taxTotal: true,
      total: true,
      currency: true,
      _info: INFO,
    },
  },
  procurementProduct: {
    scope: "company",
    fields: {
      id: true,
      catalogItem: true,
      description: true,
      customerDescription: true,
      sequenceNumber: true,
      quantity: true,
      quantityCancelled: true,
      unitOfMeasure: true,
      uom: true,
      price: true,
      cost: true,
      extPrice: true,
      extCost: true,
      margin: true,
      discount: true,
      listPrice: true,
      agreementAmount: true,
      priceMethod: true,
      billableOption: true,
      taxableFlag: true,
      dropshipFlag: true,
      specialOrderFlag: true,
      cancelledFlag: true,
      cancelledReason: true,
      cancelledDate: true,
      productClass: true,
      forecastStatus: true,
      needToPurchaseFlag: true,
      purchaseDate: true,
      vendor: true,
      vendorSku: true,
      warehouse: true,
      warehouseBin: true,
      serialNumbers: true,
      company: true,
      agreement: true,
      ticket: true,
      project: true,
      phase: true,
      salesOrder: true,
      opportunity: true,
      invoice: true,
      locationId: true,
      businessUnitId: true,
      _info: INFO,
    },
  },
  // Purchasing records name a vendor, not a customer, so they cannot be tied
  // to an approved company and are unavailable while a restriction is active.
  purchaseOrder: {
    scope: "unscoped",
    fields: {
      id: true,
      poNumber: true,
      status: true,
      poDate: true,
      dateClosed: true,
      closedFlag: true,
      vendorCompany: true,
      vendorContact: true,
      vendorSite: true,
      vendorInvoiceNumber: true,
      vendorInvoiceDate: true,
      vendorOrderNumber: true,
      customerCompany: true,
      customerContact: true,
      customerSite: true,
      dropShipCustomerFlag: true,
      warehouse: true,
      terms: true,
      shipmentMethod: true,
      shipmentDate: true,
      trackingNumber: true,
      shippingInstructions: true,
      location: true,
      department: true,
      locationId: true,
      businessUnitId: true,
      taxCode: true,
      taxPoFlag: true,
      freightCost: true,
      freightTaxTotal: true,
      subTotal: true,
      salesTax: true,
      total: true,
      currency: true,
      _info: INFO,
    },
  },
  purchaseOrderLineItem: {
    scope: "unscoped",
    fields: {
      id: true,
      purchaseOrderId: true,
      lineNumber: true,
      product: true,
      description: true,
      quantity: true,
      unitCost: true,
      unitOfMeasure: true,
      tax: true,
      receivedQuantity: true,
      receivedStatus: true,
      dateReceived: true,
      closedFlag: true,
      canceledFlag: true,
      canceledReason: true,
      backorderedFlag: true,
      expectedShipDate: true,
      shipDate: true,
      shipmentMethod: true,
      trackingNumber: true,
      serialNumbers: true,
      vendorOrderNumber: true,
      packingSlip: true,
      warehouse: true,
      warehouseBin: true,
      _info: INFO,
    },
  },
  warehouse: {
    scope: "reference",
    fields: {
      id: true,
      name: true,
      location: true,
      department: true,
      city: true,
      state: true,
      inactiveFlag: true,
      lockedFlag: true,
      _info: INFO,
    },
  },
  warehouseBin: {
    scope: "reference",
    fields: {
      id: true,
      name: true,
      warehouse: true,
      shelf: true,
      binNumber: true,
      defaultFlag: true,
      inactiveFlag: true,
      minQuantity: true,
      maxQuantity: true,
      _info: INFO,
    },
  },
  inventoryOnHand: {
    scope: "reference",
    fields: {
      id: true,
      catalogItem: true,
      warehouse: true,
      warehouseBin: true,
      onHand: true,
      serialNumbers: { id: true, serialNumber: true },
      _info: INFO,
    },
  },
  adjustment: {
    scope: "reference",
    fields: {
      id: true,
      identifier: true,
      type: true,
      reason: true,
      closedFlag: true,
      closedBy: true,
      closedDate: true,
      adjustmentDetails: {
        id: true,
        catalogItem: true,
        description: true,
        quantityOnHand: true,
        quantityAdjusted: true,
        unitCost: true,
        warehouse: true,
        warehouseBin: true,
        serialNumber: true,
      },
      _info: INFO,
    },
  },
  adjustmentDetail: {
    scope: "reference",
    fields: {
      id: true,
      adjustment: true,
      catalogItem: true,
      description: true,
      quantityOnHand: true,
      quantityAdjusted: true,
      unitCost: true,
      warehouse: true,
      warehouseBin: true,
      serialNumber: true,
      _info: INFO,
    },
  },
  contactTypeAssociation: {
    scope: "company",
    fields: { id: true, type: true, contact: true, _info: INFO },
  },
  opportunity: {
    scope: "company",
    fields: {
      id: true,
      name: true,
      expectedCloseDate: true,
      type: true,
      stage: true,
      status: true,
      priority: true,
      probability: true,
      rating: true,
      source: true,
      campaign: true,
      primarySalesRep: true,
      secondarySalesRep: true,
      company: true,
      contact: true,
      site: true,
      notes: true,
      closedDate: true,
      closedBy: true,
      closedFlag: true,
      dateBecameLead: true,
      locationId: true,
      businessUnitId: true,
      _info: INFO,
    },
  },
  opportunityForecast: {
    scope: "company",
    fields: {
      id: true,
      forecastItems: {
        id: true,
        forecastDescription: true,
        opportunity: true,
        quantity: true,
        status: true,
        catalogItem: true,
        productDescription: true,
        productClass: true,
        forecastType: true,
        revenue: true,
        includeFlag: true,
        quoteWerksQuantity: true,
        forecastPercent: true,
        recurringFlag: true,
        cycles: true,
        sequenceNumber: true,
      },
      // Flat (list-style) forecast rows on older API versions.
      forecastDescription: true,
      opportunity: true,
      quantity: true,
      status: true,
      catalogItem: true,
      productDescription: true,
      forecastType: true,
      revenue: true,
      includeFlag: true,
      forecastPercent: true,
    },
  },
  opportunityNote: {
    scope: "company",
    fields: {
      id: true,
      opportunityId: true,
      type: true,
      text: true,
      flagged: true,
      enteredBy: true,
      _info: INFO,
    },
  },
  activity: {
    scope: "company",
    fields: {
      id: true,
      name: true,
      type: true,
      status: true,
      company: true,
      contact: true,
      opportunity: true,
      ticket: true,
      agreement: true,
      campaign: true,
      notes: true,
      dateStart: true,
      dateEnd: true,
      assignedBy: true,
      assignTo: true,
      scheduleStatus: true,
      reminder: true,
      where: true,
      notifyFlag: true,
      _info: INFO,
    },
  },
  timeEntry: {
    scope: "company",
    fields: {
      id: true,
      company: true,
      chargeToId: true,
      chargeToType: true,
      member: true,
      locationId: true,
      businessUnitId: true,
      workType: true,
      workRole: true,
      agreement: true,
      timeStart: true,
      timeEnd: true,
      hoursDeduct: true,
      actualHours: true,
      billableOption: true,
      notes: true,
      addToDetailDescriptionFlag: true,
      addToInternalAnalysisFlag: true,
      addToResolutionFlag: true,
      // Read back by cw_create_time_entry to confirm no email was requested.
      emailContactFlag: true,
      emailResourceFlag: true,
      emailCcFlag: true,
      hoursBilled: true,
      invoiceHours: true,
      status: true,
      dateEntered: true,
      enteredBy: true,
      ticket: true,
      project: true,
      phase: true,
      timeSheet: true,
      _info: INFO,
    },
  },
  scheduleEntry: {
    scope: "unscoped",
    fields: {
      id: true,
      objectId: true,
      name: true,
      member: true,
      where: true,
      dateStart: true,
      dateEnd: true,
      reminder: true,
      status: true,
      type: true,
      span: true,
      doneFlag: true,
      acknowledgedFlag: true,
      ownerFlag: true,
      meetingFlag: true,
      allowScheduleConflictsFlag: true,
      hours: true,
      closeDate: true,
      _info: INFO,
    },
  },
  member: {
    scope: "reference",
    fields: {
      id: true,
      identifier: true,
      firstName: true,
      lastName: true,
      title: true,
      inactiveFlag: true,
      defaultDepartment: true,
      defaultLocation: true,
      type: true,
    },
  },
  catalogItem: {
    scope: "reference",
    fields: {
      id: true,
      identifier: true,
      description: true,
      customerDescription: true,
      inactiveFlag: true,
      category: true,
      subcategory: true,
      type: true,
      productClass: true,
      serializedFlag: true,
      manufacturer: true,
      manufacturerPartNumber: true,
      vendor: true,
      vendorSku: true,
      unitOfMeasure: true,
      price: true,
      cost: true,
      taxableFlag: true,
      _info: INFO,
    },
  },
  reference: { scope: "reference", fields: REFERENCE_FIELDS },
  systemInfo: {
    scope: "reference",
    fields: {
      version: true,
      isCloud: true,
      serverTimeZone: true,
      cloudRegion: true,
    },
  },
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface Route {
  readonly resource: string;
  readonly def: ResourceDef;
  /** Record whose company governs this path (for sub-resources). */
  readonly parent?: { readonly resource: string; readonly path: string };
  /** True when the path addresses one record of `resource` by ID. */
  readonly isItem: boolean;
  /** Sub-resource rows carry their own company and are checked against it too. */
  readonly rowScope: boolean;
}

interface RouteSpec {
  readonly pattern: RegExp;
  readonly resource: string;
  readonly isItem?: boolean;
  /** Parent resource; its path is the first capture group. */
  readonly parent?: string;
  readonly rowScope?: boolean;
}

const ID = "\\d{1,12}";

const ROUTES: readonly RouteSpec[] = [
  { pattern: /^\/service\/tickets$/, resource: "ticket" },
  { pattern: new RegExp(`^/service/tickets/${ID}$`), resource: "ticket", isItem: true },
  { pattern: new RegExp(`^(/service/tickets/${ID})/(?:notes|allNotes)$`), resource: "ticketNote", parent: "ticket" },
  { pattern: new RegExp(`^(/service/tickets/${ID})/tasks$`), resource: "ticketTask", parent: "ticket" },
  { pattern: new RegExp(`^(/service/tickets/${ID})/tasks/${ID}$`), resource: "ticketTask", parent: "ticket", isItem: true },
  { pattern: new RegExp(`^(/service/tickets/${ID})/configurations$`), resource: "ticketConfiguration", parent: "ticket", rowScope: true },
  { pattern: new RegExp(`^(/service/tickets/${ID})/configurations/${ID}$`), resource: "ticketConfiguration", parent: "ticket", isItem: true, rowScope: true },

  { pattern: /^\/project\/tickets$/, resource: "ticket" },
  { pattern: new RegExp(`^/project/tickets/${ID}$`), resource: "ticket", isItem: true },
  { pattern: new RegExp(`^(/project/tickets/${ID})/(?:notes|allNotes)$`), resource: "ticketNote", parent: "ticket" },
  { pattern: /^\/project\/projects$/, resource: "project" },
  { pattern: new RegExp(`^/project/projects/${ID}$`), resource: "project", isItem: true },

  { pattern: /^\/company\/companies$/, resource: "company" },
  { pattern: new RegExp(`^/company/companies/${ID}$`), resource: "company", isItem: true },
  { pattern: /^\/company\/contacts$/, resource: "contact" },
  { pattern: new RegExp(`^/company/contacts/${ID}$`), resource: "contact", isItem: true },
  { pattern: new RegExp(`^(/company/contacts/${ID})/typeAssociations$`), resource: "contactTypeAssociation", parent: "contact" },
  { pattern: new RegExp(`^(/company/contacts/${ID})/typeAssociations/${ID}$`), resource: "contactTypeAssociation", parent: "contact", isItem: true },
  { pattern: /^\/company\/(?:contacts\/types|communicationTypes)$/, resource: "reference" },
  { pattern: /^\/company\/configurations$/, resource: "configuration" },
  { pattern: new RegExp(`^/company/configurations/${ID}$`), resource: "configuration", isItem: true },

  { pattern: /^\/finance\/agreements$/, resource: "agreement" },
  { pattern: new RegExp(`^/finance/agreements/${ID}$`), resource: "agreement", isItem: true },
  { pattern: new RegExp(`^(/finance/agreements/${ID})/additions$`), resource: "agreementAddition", parent: "agreement" },
  { pattern: new RegExp(`^(/finance/agreements/${ID})/additions/${ID}$`), resource: "agreementAddition", parent: "agreement", isItem: true },
  { pattern: /^\/finance\/agreementrecap\/?$/, resource: "agreementRecap" },
  { pattern: new RegExp(`^/finance/agreementrecap/${ID}$`), resource: "agreementRecap", isItem: true },
  { pattern: /^\/finance\/invoices$/, resource: "invoice" },
  { pattern: new RegExp(`^/finance/invoices/${ID}$`), resource: "invoice", isItem: true },

  { pattern: /^\/sales\/opportunities$/, resource: "opportunity" },
  { pattern: new RegExp(`^/sales/opportunities/${ID}$`), resource: "opportunity", isItem: true },
  { pattern: new RegExp(`^(/sales/opportunities/${ID})/forecast$`), resource: "opportunityForecast", parent: "opportunity" },
  { pattern: new RegExp(`^(/sales/opportunities/${ID})/notes$`), resource: "opportunityNote", parent: "opportunity" },
  { pattern: /^\/sales\/orders$/, resource: "salesOrder" },
  { pattern: new RegExp(`^/sales/orders/${ID}$`), resource: "salesOrder", isItem: true },
  { pattern: /^\/sales\/activities$/, resource: "activity" },
  { pattern: new RegExp(`^/sales/activities/${ID}$`), resource: "activity", isItem: true },

  { pattern: /^\/time\/entries$/, resource: "timeEntry" },
  { pattern: new RegExp(`^/time/entries/${ID}$`), resource: "timeEntry", isItem: true },

  { pattern: /^\/schedule\/entries$/, resource: "scheduleEntry" },
  { pattern: new RegExp(`^/schedule/entries/${ID}$`), resource: "scheduleEntry", isItem: true },

  { pattern: /^\/system\/members$/, resource: "member" },
  { pattern: new RegExp(`^/system/members/${ID}$`), resource: "member", isItem: true },
  { pattern: /^\/procurement\/catalog$/, resource: "catalogItem" },
  { pattern: new RegExp(`^/procurement/catalog/${ID}$`), resource: "catalogItem", isItem: true },

  { pattern: /^\/procurement\/products$/, resource: "procurementProduct" },
  { pattern: new RegExp(`^/procurement/products/${ID}$`), resource: "procurementProduct", isItem: true },
  { pattern: /^\/procurement\/purchaseorders$/, resource: "purchaseOrder" },
  { pattern: new RegExp(`^/procurement/purchaseorders/${ID}$`), resource: "purchaseOrder", isItem: true },
  { pattern: new RegExp(`^(/procurement/purchaseorders/${ID})/lineitems$`), resource: "purchaseOrderLineItem", parent: "purchaseOrder" },
  { pattern: /^\/procurement\/warehouses$/, resource: "warehouse" },
  { pattern: /^\/procurement\/warehouseBins$/, resource: "warehouseBin" },
  { pattern: new RegExp(`^/procurement/warehouseBins/${ID}/inventoryOnHand$`), resource: "inventoryOnHand" },
  { pattern: /^\/procurement\/adjustments$/, resource: "adjustment" },
  { pattern: new RegExp(`^/procurement/adjustments/${ID}$`), resource: "adjustment", isItem: true },
  { pattern: new RegExp(`^/procurement/adjustments/${ID}/details$`), resource: "adjustmentDetail" },
  { pattern: /^\/procurement\/adjustments\/types$/, resource: "reference" },

  { pattern: /^\/service\/(?:boards|priorities)$/, resource: "reference" },
  { pattern: new RegExp(`^/service/boards/${ID}/(?:statuses|types|subtypes|items)$`), resource: "reference" },
  { pattern: /^\/time\/(?:workTypes|workRoles)$/, resource: "reference" },
  { pattern: /^\/schedule\/(?:types|statuses|calendars|holidays)$/, resource: "reference" },
  { pattern: /^\/procurement\/(?:categories|subCategories|manufacturers)$/, resource: "reference" },
  { pattern: /^\/sales\/stages$/, resource: "reference" },
  { pattern: /^\/sales\/activities\/(?:types|statuses)$/, resource: "reference" },

  { pattern: /^\/system\/info$/, resource: "systemInfo", isItem: true },
];

/** Resolve an API path to its route, or null when the path is not permitted. */
export function matchRoute(path: string): Route | null {
  for (const spec of ROUTES) {
    const m = spec.pattern.exec(path);
    if (!m) continue;
    const def = RESOURCES[spec.resource]!;
    return {
      resource: spec.resource,
      def,
      isItem: spec.isItem ?? false,
      rowScope: spec.rowScope ?? false,
      parent: spec.parent ? { resource: spec.parent, path: m[1]! } : undefined,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Field filtering
// ---------------------------------------------------------------------------

const REFERENCE_KEYS = ["id", "name", "identifier", "summary"] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reduce a nested object to an inert reference: scalar id/name/identifier/summary only. */
function toReference(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of REFERENCE_KEYS) {
    const v = obj[key];
    if (v !== undefined && v !== null && typeof v !== "object") out[key] = v;
  }
  return out;
}

function applySpec(value: unknown, spec: FieldSpec): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => applySpec(item, spec));
  }
  if (isPlainObject(value)) {
    return spec === true ? toReference(value) : filterFields(value, spec);
  }
  // Scalars only pass when the spec says "scalar"; a nested allowlist expects an object.
  return spec === true ? value : undefined;
}

export function filterFields(
  record: Record<string, unknown>,
  fields: FieldMap,
  extra?: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (NEVER_RETURNED.has(key)) continue;
    const spec: FieldSpec | undefined =
      fields[key] ?? (extra?.has(key) ? EXTRA_FIELD_SPEC : undefined);
    if (spec === undefined) continue;
    const filtered =
      spec === EXTRA_FIELD_SPEC ? sanitizeExtra(value, 0) : applySpec(value, spec);
    if (filtered !== undefined) out[key] = filtered;
  }
  return out;
}

/**
 * Operator-added fields (CW_MANAGE_EXTRA_FIELDS) are returned as stored, since
 * their shape is not known here — but never the fields in NEVER_RETURNED, at
 * any depth.
 */
const EXTRA_FIELD_SPEC: FieldSpec = Object.freeze({});

function sanitizeExtra(value: unknown, depth: number): unknown {
  if (depth > 6) return undefined;
  if (Array.isArray(value)) return value.map((v) => sanitizeExtra(v, depth + 1));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (NEVER_RETURNED.has(k) || k === "_info") continue;
      out[k] = sanitizeExtra(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Company record ID governing a record, or undefined when it has none. */
export function companyIdOf(
  record: unknown,
  def: ResourceDef,
): number | undefined {
  if (!isPlainObject(record)) return undefined;
  const field = def.companyField ?? "company";
  const ref = field === "." ? record : record[field];
  if (!isPlainObject(ref)) return undefined;
  const id = ref.id;
  return typeof id === "number" && Number.isInteger(id) ? id : undefined;
}
