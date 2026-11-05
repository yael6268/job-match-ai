import { useCallback, useEffect, useState } from 'react';
import { listContacts } from '@/db/repo';
import { getCompanies } from '@/shared/companies';
import { contactsAt } from '@/shared/contacts';
import type { Company, Contact } from '@/shared/types';

/** Loads contacts + companies once; returns a lookup "contacts at this job's company" (name or alias). */
export function useContactsAt(): (jobCompany: string) => Contact[] {
  const [data, setData] = useState<{ contacts: Contact[]; companies: Company[] }>({ contacts: [], companies: [] });

  useEffect(() => {
    Promise.all([listContacts(), getCompanies().catch(() => [] as Company[])])
      .then(([contacts, companies]) => setData({ contacts, companies }))
      .catch(() => { /* no contacts: referral options simply do not show */ });
  }, []);

  return useCallback((jobCompany: string) => contactsAt(jobCompany, data.contacts, data.companies), [data]);
}
