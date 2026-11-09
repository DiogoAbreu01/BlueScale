import { describe, expect, it } from 'vitest';
import { memberSchema } from '../src/lib/schemas';

const base = { identifier: 'member-123', fullName: 'Pessoa Teste', departmentId: 'department-1' };

describe('cadastro de membros com e-mail opcional', () => {
  it.each([undefined, '', null])('aceita e-mail ausente/vazio (%s)', (email) => {
    const input = email === undefined ? base : { ...base, email };
    expect(memberSchema.parse(input).email).toBeNull();
  });

  it('aceita e normaliza um e-mail valido', () => {
    expect(memberSchema.parse({ ...base, email: 'Pessoa@Example.com' }).email).toBe('pessoa@example.com');
  });

  it('rejeita e-mail informado que seja invalido', () => {
    expect(memberSchema.safeParse({ ...base, email: 'nao-e-um-email' }).success).toBe(false);
  });

  it('PATCH sem email nao apaga o valor que ja existe', () => {
    const patch = memberSchema.partial().parse({ status: 'INACTIVE' });
    expect(patch).not.toHaveProperty('email');
    expect(memberSchema.partial().parse({ email: '' }).email).toBeNull();
  });
});
