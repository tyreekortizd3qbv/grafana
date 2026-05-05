import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestProvider } from 'test/helpers/TestProvider';

import { OrgRole } from '@grafana/data';
import { ContextSrv, setContextSrv } from 'app/core/services/context_srv';
import { getUserOrganizations, setUserOrganization } from 'app/features/org/state/actions';
import { type StoreState } from 'app/types/store';

import { OrganizationSwitcher } from './OrganizationSwitcher';

const mockDispatch = jest.fn();
const mockAssign = jest.fn();

jest.mock('app/features/org/state/actions', () => ({
  ...jest.requireActual('app/features/org/state/actions'),
  getUserOrganizations: jest.fn(),
  setUserOrganization: jest.fn(),
}));

jest.mock('app/types/store', () => ({
  ...jest.requireActual('app/types/store'),
  useDispatch: () => mockDispatch,
}));

const twoOrgInitialState: Partial<StoreState> = {
  organization: {
    organization: { name: 'test', id: 1 },
    userOrgs: [
      { orgId: 1, name: 'test', role: OrgRole.Admin },
      { orgId: 2, name: 'test2', role: OrgRole.Admin },
    ],
  },
};

const renderWithProvider = ({ initialState }: { initialState?: Partial<StoreState> }) => {
  render(
    <TestProvider storeState={initialState}>
      <OrganizationSwitcher />
    </TestProvider>
  );
};

describe('OrganisationSwitcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDispatch.mockResolvedValue(undefined);
    jest.spyOn(window, 'matchMedia').mockImplementation(
      () =>
        ({
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          matches: true,
        }) as unknown as MediaQueryList
    );
    // jsdom makes window.location read-only; replace the whole object so assign is writable
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: mockAssign },
      writable: true,
    });
  });

  it('should only render if more than one organisations', () => {
    renderWithProvider({
      initialState: twoOrgInitialState,
    });

    expect(screen.getByRole('combobox', { name: 'Change organization' })).toBeInTheDocument();
  });

  it('should not render if there is only one organisation', () => {
    renderWithProvider({
      initialState: {
        organization: {
          organization: { name: 'test', id: 1 },
          userOrgs: [{ orgId: 1, name: 'test', role: OrgRole.Admin }],
        },
      },
    });

    expect(screen.queryByRole('combobox', { name: 'Change organization' })).not.toBeInTheDocument();
  });

  it('should not render if there is no organisation available', () => {
    renderWithProvider({
      initialState: {
        organization: {
          organization: { name: 'test', id: 1 },
          userOrgs: [],
        },
      },
    });

    expect(screen.queryByRole('combobox', { name: 'Change organization' })).not.toBeInTheDocument();
  });

  it('should not render and not try to get user organizations if not signed in', () => {
    const contextSrv = new ContextSrv();
    contextSrv.user.isSignedIn = false;
    setContextSrv(contextSrv);

    renderWithProvider({
      initialState: {
        organization: {
          organization: { name: 'test', id: 1 },
          userOrgs: [],
        },
      },
    });

    expect(screen.queryByRole('combobox', { name: 'Change organization' })).not.toBeInTheDocument();
    expect(getUserOrganizations).not.toHaveBeenCalled();
  });

  describe('onSelectChange', () => {
    it('should dispatch setUserOrganization when an org is selected', async () => {
      const thunkAction = jest.fn();
      (setUserOrganization as jest.Mock).mockReturnValue(thunkAction);

      renderWithProvider({ initialState: twoOrgInitialState });

      await userEvent.click(screen.getByRole('combobox', { name: 'Change organization' }));
      await userEvent.click(await screen.findByText('test2'));

      expect(setUserOrganization).toHaveBeenCalledWith(2);
      expect(mockDispatch).toHaveBeenCalledWith(thunkAction);
    });

    it('should navigate with window.location.assign after dispatch resolves', async () => {
      renderWithProvider({ initialState: twoOrgInitialState });

      await userEvent.click(screen.getByRole('combobox', { name: 'Change organization' }));
      await userEvent.click(await screen.findByText('test2'));

      expect(mockAssign).toHaveBeenCalledWith('/?orgId=2');
    });

    it('should not navigate if dispatch rejects (API failure)', async () => {
      // When dispatch throws (e.g. network failure), backendSrv already shows an error toast
      // via its own error-alert pipeline. The component catches the rejection so it does not
      // become an unhandled promise and does not call window.location.assign.
      mockDispatch.mockRejectedValue(new Error('Network error'));

      renderWithProvider({ initialState: twoOrgInitialState });

      await userEvent.click(screen.getByRole('combobox', { name: 'Change organization' }));
      await userEvent.click(await screen.findByText('test2'));
      await new Promise((r) => setTimeout(r, 50));

      expect(mockAssign).not.toHaveBeenCalled();
    });

    it('should not dispatch or navigate when option.value is undefined', async () => {
      renderWithProvider({ initialState: twoOrgInitialState });
      // Guard clause in onSelectChange: nothing happens before an org is picked
      expect(mockDispatch).not.toHaveBeenCalledWith(expect.anything());
      expect(mockAssign).not.toHaveBeenCalled();
    });

    it('should use window.location.assign (not reload) to navigate — no intermediate pushState render', async () => {
      renderWithProvider({ initialState: twoOrgInitialState });

      await userEvent.click(screen.getByRole('combobox', { name: 'Change organization' }));
      await userEvent.click(await screen.findByText('test2'));

      expect(mockAssign).toHaveBeenCalledTimes(1);
      expect(mockAssign).toHaveBeenCalledWith('/?orgId=2');
    });

    it('should await dispatch before navigating so POST completes before page reload', async () => {
      const callOrder: string[] = [];
      mockDispatch.mockImplementation(
        () =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              callOrder.push('dispatch-resolved');
              resolve();
            }, 10)
          )
      );
      mockAssign.mockImplementation(() => callOrder.push('assign-called'));

      renderWithProvider({ initialState: twoOrgInitialState });

      await userEvent.click(screen.getByRole('combobox', { name: 'Change organization' }));
      await userEvent.click(await screen.findByText('test2'));

      await new Promise((r) => setTimeout(r, 50));

      expect(callOrder).toEqual(['dispatch-resolved', 'assign-called']);
    });
  });
});
