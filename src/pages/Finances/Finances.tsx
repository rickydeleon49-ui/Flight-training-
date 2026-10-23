import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Dialog,
  EditIcon,
  EmptyState,
  Field,
  IconButton,
  Meter,
  PlusIcon,
  TextInput,
  TrashIcon,
  WalletIcon,
} from "@/components/ui";
import {
  EXPENSE_CATEGORY_LABELS,
  type Transaction,
  type TransactionType,
} from "@/domain/types";
import { formatMonthYear, formatShortDate, todayIso } from "@/lib/dates";
import { formatMoney, moneyToInput, parseMoney } from "@/lib/money";
import {
  fundSummary,
  monthlySpending,
  spentInMonth,
  totalUpcoming,
  trainingCostSummary,
  upcomingExpenses,
} from "@/logic/finance";
import { useAppData } from "@/state/AppDataContext";

import { TransactionFormDialog, type TransactionDraft } from "./TransactionFormDialog";
import "./finances.css";

export function Finances() {
  const { data, mutate, deleteWithUndo } = useAppData();
  const today = todayIso();

  const [formType, setFormType] = useState<TransactionType | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [editingTarget, setEditingTarget] = useState(false);

  const summary = useMemo(() => fundSummary(data.transactions), [data.transactions]);
  const upcoming = useMemo(
    () => upcomingExpenses(data.events, data.transactions, today),
    [data.events, data.transactions, today],
  );
  const thisMonth = spentInMonth(data.transactions, today);
  const months = useMemo(() => monthlySpending(data.transactions, today), [data.transactions, today]);
  const costs = useMemo(
    () => trainingCostSummary(data.transactions, data.journalEntries),
    [data.transactions, data.journalEntries],
  );
  const fundGoal = data.fundGoals.find((goal) => goal.active) ?? null;

  const recent = data.transactions.slice(0, 20);

  const save = async (draft: TransactionDraft) => {
    const result = editing
      ? await mutate((repos) => repos.finance.update(editing.id, draft))
      : await mutate((repos) => repos.finance.create(draft));
    if (result === null) return;
    setEditing(null);
    setFormType(null);
  };

  if (data.transactions.length === 0) {
    return (
      <>
        <PageHeader title="Finances" subtitle="What you have set aside, and what training is costing." />
        <Card>
          <EmptyState
            icon={<WalletIcon size={30} />}
            title="Your Flight Fund starts here."
            body="Record what you have set aside for training and what you spend. Estimated lesson costs from your Schedule will show up as upcoming expenses."
            action={
              <div className="row row--wrap" style={{ justifyContent: "center" }}>
                <Button variant="primary" onClick={() => setFormType("contribution")}>
                  Add funds
                </Button>
                <Button onClick={() => setFormType("expense")}>Record an expense</Button>
              </div>
            }
          />
        </Card>
        <TransactionFormDialog
          open={formType !== null}
          type={formType ?? "contribution"}
          events={data.events}
          onClose={() => setFormType(null)}
          onSave={save}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Finances"
        subtitle="What you have set aside, and what training is costing."
        action={
          <div className="row">
            <Button variant="primary" onClick={() => setFormType("contribution")}>
              <PlusIcon size={16} /> Add funds
            </Button>
            <Button onClick={() => setFormType("expense")}>
              <PlusIcon size={16} /> Add expense
            </Button>
          </div>
        }
      />

      <div className="stack stack--5">
        <div className="fund">
          <div className="fund__figure fund__figure--primary">
            <p className="fund__label">Available for training</p>
            <p className={`fund__value${summary.balance < 0 ? " fund__value--negative" : ""}`}>
              {formatMoney(summary.balance)}
            </p>
          </div>
          <div className="fund__figure">
            <p className="fund__label">Total added</p>
            <p className="fund__value">{formatMoney(summary.totalContributed)}</p>
          </div>
          <div className="fund__figure">
            <p className="fund__label">Total spent</p>
            <p className="fund__value">{formatMoney(summary.totalSpent)}</p>
          </div>
        </div>

        <div className="detail">
          <div className="detail__column">
            <Card>
              <CardHeader
                title="Recent activity"
                action={<span className="tiny dim">{data.transactions.length} transactions</span>}
              />
              <CardBody flush>
                {recent.map((transaction) => {
                  const event = data.events.find((e) => e.id === transaction.eventId);
                  const income = transaction.type === "contribution";
                  return (
                    <div className="txn-row" key={transaction.id}>
                      <span className="txn-row__date">{formatShortDate(transaction.date)}</span>
                      <span className="txn-row__main">
                        <span className="txn-row__title wrap-anywhere">
                          {transaction.description ||
                            (income ? "Added to fund" : EXPENSE_CATEGORY_LABELS[transaction.category])}
                        </span>
                        <span className="row row--wrap" style={{ gap: "var(--space-2)", marginTop: 2 }}>
                          {income ? (
                            <Badge tone="complete">Added</Badge>
                          ) : (
                            <Badge>{EXPENSE_CATEGORY_LABELS[transaction.category]}</Badge>
                          )}
                          {event ? (
                            <Link className="tiny" to={`/schedule/${event.id}`}>
                              {event.title}
                            </Link>
                          ) : null}
                          {transaction.source === "lesson_cost" ? (
                            <span className="tiny dim">from lesson</span>
                          ) : null}
                        </span>
                      </span>
                      <span className={`txn-row__amount txn-row__amount--${income ? "in" : "out"}`}>
                        {income ? "+" : "−"}
                        {formatMoney(transaction.amount)}
                      </span>
                      <span className="txn-row__tools">
                        <IconButton
                          label={`Edit ${transaction.description || "transaction"}`}
                          onClick={() => setEditing(transaction)}
                        >
                          <EditIcon size={15} />
                        </IconButton>
                        <IconButton
                          className="destructive-action" label={`Delete ${transaction.description || "transaction"}`}
                          tone="danger"
                          onClick={() => setDeleting(transaction)}
                        >
                          <TrashIcon size={15} />
                        </IconButton>
                      </span>
                    </div>
                  );
                })}
              </CardBody>
            </Card>
          </div>

          <div className="detail__column">
            <Card>
              <CardHeader
                title="Savings target"
                action={
                  <Button size="small" variant="ghost" onClick={() => setEditingTarget(true)}>
                    {fundGoal ? "Change" : "Set one"}
                  </Button>
                }
              />
              <CardBody>
                {fundGoal ? (
                  <div className="stack stack--3">
                    <p className="small muted">{fundGoal.title}</p>
                    <Meter
                      value={Math.max(0, summary.balance)}
                      max={fundGoal.target}
                      startLabel={formatMoney(summary.balance)}
                      endLabel={formatMoney(fundGoal.target)}
                      ariaLabel={`Progress toward ${fundGoal.title}`}
                    />
                    <p className="tiny dim">
                      This is real money you have set aside against a target you chose.
                    </p>
                  </div>
                ) : (
                  <p className="small muted">
                    Set an amount you are saving toward and this will track it against what
                    is actually in your fund.
                  </p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Coming up" />
              <CardBody>
                {upcoming.length === 0 ? (
                  <p className="small muted">
                    No estimated costs ahead. Add an estimate to a scheduled lesson and it
                    will appear here.
                  </p>
                ) : (
                  <div className="stack stack--3">
                    {upcoming.slice(0, 6).map(({ event, amount }) => (
                      <div className="row row--between" key={event.id}>
                        <Link className="small truncate" to={`/schedule/${event.id}`}>
                          {event.title}
                        </Link>
                        <span className="small numeric dim">{formatMoney(amount)}</span>
                      </div>
                    ))}
                    <hr className="divider" />
                    <div className="row row--between">
                      <span className="small strong">Estimated total</span>
                      <span className="small strong numeric">
                        {formatMoney(totalUpcoming(upcoming))}
                      </span>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="What training is costing" />
              <CardBody>
                <div className="insight-list">
                  <div>
                    <p className="insight__label">Spent this month</p>
                    <p className="insight__value">{formatMoney(thisMonth)}</p>
                  </div>
                  <div>
                    <p className="insight__label">Paid lessons</p>
                    <p className="insight__value">{costs.lessons.length}</p>
                  </div>
                  <div>
                    <p className="insight__label">Average lesson</p>
                    <p className="insight__value">
                      {costs.averageLesson === null ? "—" : formatMoney(costs.averageLesson)}
                    </p>
                  </div>
                  <div>
                    <p className="insight__label">Per flight hour</p>
                    <p className="insight__value">
                      {costs.perFlightHour === null ? "—" : formatMoney(costs.perFlightHour.perHour)}
                    </p>
                  </div>
                  <div>
                    <p className="insight__label">Upcoming estimated</p>
                    <p className="insight__value">{formatMoney(totalUpcoming(upcoming))}</p>
                  </div>
                </div>
                <p className="tiny dim" style={{ marginTop: "var(--space-4)" }}>
                  Averages come from the lesson and rental expenses you have recorded. Expenses
                  linked to the same lesson count as one lesson. They are not a forecast.
                </p>
                <p className="tiny dim" data-testid="per-hour-basis" style={{ marginTop: "var(--space-2)" }}>
                  {costs.perFlightHour === null
                    ? "Per flight hour needs a lesson with a recorded cost and a journal entry for that lesson with its total time."
                    : `Per flight hour uses ${costs.perFlightHour.lessonsCounted} of ${costs.lessons.length} ${costs.lessons.length === 1 ? "lesson" : "lessons"}: those with logged flight time (${costs.perFlightHour.hours} hr).`}
                </p>
                {costs.possibleDoubleCounts.length > 0 && (
                  <div className="stack stack--2" role="note" style={{ marginTop: "var(--space-4)" }}>
                    <p className="small">
                      {costs.possibleDoubleCounts.length === 1
                        ? "One lesson has a recorded lesson total and separate lesson expenses. If they are the same money, edit or delete one so it isn't counted twice."
                        : `${costs.possibleDoubleCounts.length} lessons have a recorded lesson total and separate lesson expenses. If they are the same money, edit or delete one so it isn't counted twice.`}
                    </p>
                    {costs.possibleDoubleCounts.map((item) => (
                      <div className="row row--between" key={item.eventId}>
                        <Link className="small truncate" to={`/schedule/${item.eventId}`}>
                          {data.events.find((event) => event.id === item.eventId)?.title || "Lesson"}
                        </Link>
                        <span className="small numeric dim">{formatMoney(item.cost)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Spending by month" />
              <CardBody>
                <table className="month-table">
                  <caption className="visually-hidden">Recorded spending for the last six months</caption>
                  <thead>
                    <tr>
                      <th scope="col">Month</th>
                      <th scope="col">Spent</th>
                      <th scope="col">On lessons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months
                      .slice()
                      .reverse()
                      .map((row) => (
                        <tr key={row.month}>
                          <th scope="row">{formatMonthYear(`${row.month}-01`)}</th>
                          <td className="numeric">{formatMoney(row.spent)}</td>
                          <td className="numeric dim">{formatMoney(row.lessons)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <p className="tiny dim" style={{ marginTop: "var(--space-3)" }}>
                  Only expenses you have recorded. Estimated lesson costs stay under Coming up.
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>

      <TransactionFormDialog
        open={formType !== null || editing !== null}
        type={formType ?? "expense"}
        transaction={editing}
        events={data.events}
        onClose={() => {
          setFormType(null);
          setEditing(null);
        }}
        onSave={save}
      />

      <FundGoalDialog
        open={editingTarget}
        currentTitle={fundGoal?.title ?? "Next phase of training"}
        currentTarget={fundGoal?.target ?? null}
        onClose={() => setEditingTarget(false)}
        onSave={async (title, target) => {
          const result = await mutate((repos) => repos.finance.saveFundGoal({ title, target }));
          if (result === null) return;
          setEditingTarget(false);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this transaction?"
        message="Your balance is recalculated from what is left, so it stays correct."
        onConfirm={() => {
          const transaction = deleting;
          setDeleting(null);
          if (transaction) {
            deleteWithUndo({
              ids: [transaction.id],
              label: transaction.description,
              run: (repos) => repos.finance.remove(transaction.id),
            });
          }
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function FundGoalDialog({
  open,
  currentTitle,
  currentTarget,
  onClose,
  onSave,
}: {
  open: boolean;
  currentTitle: string;
  currentTarget: number | null;
  onClose: () => void;
  onSave: (title: string, target: number) => void;
}) {
  const [title, setTitle] = useState(currentTitle);
  const [target, setTarget] = useState(moneyToInput(currentTarget));
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Savings target"
      description="An amount you are working toward for the next stage of training."
      narrow
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              const cents = parseMoney(target);
              if (cents === null || cents <= 0) {
                setError("Enter an amount like 5000.");
                return;
              }
              onSave(title.trim() || "Savings target", cents);
            }}
          >
            Save target
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="What is it for?" full>
          {({ id }) => (
            <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} />
          )}
        </Field>
        <Field label="Target amount" error={error} full>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              inputMode="decimal"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={target}
              placeholder="5000"
              onChange={(e) => setTarget(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
