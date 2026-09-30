// 来源 assistant-ui f008537，MIT；保留官方布局，Studio 适配见 UI-STARTER.md。
import type * as React from "react";
import { MessagesSquare } from "lucide-react";
import { GitHubIcon } from "../../icons/github";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "../../ui/sidebar";


export function ThreadListSidebar({
  children, footer, ...props
}: React.ComponentProps<typeof Sidebar> & { footer?: React.ReactNode }) {
  return (
    <Sidebar {...props}>
      <SidebarHeader className="aui-sidebar-header mb-2 border-b">
        <div className="aui-sidebar-header-content flex items-center justify-between">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                render={
                  <a
                    href="/studio/chat"
                  />
                }
              >
                <div className="aui-sidebar-header-icon-wrapper bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <MessagesSquare className="aui-sidebar-header-icon size-4" />
                </div>
                <div className="aui-sidebar-header-heading me-6 flex flex-col gap-0.5 leading-none">
                  <span className="aui-sidebar-header-title font-semibold">
                    Gouo Canvas
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarHeader>
      <SidebarContent className="aui-sidebar-content px-2">
        {children}
      </SidebarContent>
      {props.collapsible !== "none" && <SidebarRail />}
      <SidebarFooter className="aui-sidebar-footer border-t">
        {footer ?? <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={
                <a
                  href="https://github.com/assistant-ui/assistant-ui"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <div className="aui-sidebar-footer-icon-wrapper bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <GitHubIcon className="aui-sidebar-footer-icon size-4" />
              </div>
              <div className="aui-sidebar-footer-heading flex flex-col gap-0.5 leading-none">
                <span className="aui-sidebar-footer-title font-semibold">
                  GitHub
                </span>
                <span>View Source</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>}
      </SidebarFooter>
    </Sidebar>
  );
}
