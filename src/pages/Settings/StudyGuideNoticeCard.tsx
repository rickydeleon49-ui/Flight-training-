import { useState } from "react";

import { Card, CardBody, CardHeader, Checkbox } from "@/components/ui";
import { askPermission } from "@/services/notify";
import { useAppData } from "@/state/AppDataContext";

export const NOTICE_DENIED_LINE =
  "Turn on notifications for Your Flight Deck in System Settings › Notifications.";
export const NOTICE_ASK_LINE = "Your Mac will ask once — choose Allow.";

/** One switch: tell you when a study guide is ready while the app is in the background. */
export function StudyGuideNoticeCard() {
  const { data, mutate } = useAppData();
  const [denied, setDenied] = useState(false);
  const on = data.toolkit.studyGuideNotice === true;

  const change = async (enabled: boolean) => {
    setDenied(false);
    // Permission is asked here, from your tap, and nowhere else.
    if (enabled && !(await askPermission())) {
      setDenied(true);
      return;
    }
    await mutate((repos) => repos.toolkit.save({ ...data.toolkit, studyGuideNotice: enabled }));
  };

  return (
    <Card variant="grouped">
      <CardHeader title="Notifications" eyebrow="On this device" />
      <CardBody>
        <div className="stack stack--3">
          <Checkbox
            checked={on}
            onChange={(enabled) => void change(enabled)}
            strikethrough={false}
            label="Tell me when a study guide is ready"
          />
          {denied ? (
            <p className="small muted" role="status">{NOTICE_DENIED_LINE}</p>
          ) : on ? null : (
            <p className="small muted">{NOTICE_ASK_LINE}</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
