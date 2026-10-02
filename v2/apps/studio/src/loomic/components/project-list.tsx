"use client";

import type { LocalProjectSummary as ProjectSummary } from "../lib/local-drafts";
import { FileImage, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { useDeleteProject } from "@/hooks/use-delete-project";
import { formatDate } from "@/lib/utils";

interface ProjectListProps {
  projects: ProjectSummary[];
  highlightId?: string | null;
  loading?: boolean;
  error?: string;
  creating?: boolean;
  onCreateClick: () => void;
  onDeleted?: (projectId: string) => void;
}

export function ProjectList({ projects, highlightId, loading = false, error, creating = false, onCreateClick, onDeleted }: ProjectListProps) {
  const { pendingId, deleting, requestDelete, confirmDelete, cancelDelete } =
    useDeleteProject(onDeleted ? { onDeleted } : undefined);

  return <section aria-label="本地创作" className="projects-section" aria-busy={loading}>
    <div className="projects-section-header">
      <div><h2 aria-label="本地创作">本地创作 <span className="projects-scope">当前浏览器</span></h2><p>画布保存在当前浏览器，导出后可以备份。</p></div>
      <button type="button" className="projects-button" onClick={onCreateClick} disabled={creating}><Plus size={16} aria-hidden="true" />{creating ? '正在新建…' : '新建项目'}</button>
    </div>
    {error ? <p role="alert" className="projects-error">本地创作读取失败：{error}。请保留浏览器数据并刷新重试。</p> : loading ? <p role="status" className="projects-state">正在读取本地创作…</p> : projects.length === 0 ?
      <div className="projects-state"><FileImage size={28} aria-hidden="true" /><p>还没有本地创作</p><span>新建项目，开始整理你的创意与素材。</span></div> :
      <ul className="projects-list">{projects.map(project => <li key={project.id} className={`projects-row${highlightId === project.id ? ' projects-row-highlighted' : ''}`}>
        <Link href={`/canvas?id=${project.primaryCanvas.id}`} aria-label={project.name} className="projects-row-link">
          <span className="projects-preview"><FileImage size={22} aria-hidden="true" />{project.thumbnailUrl && <img src={project.thumbnailUrl} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} />}</span>
          <span className="projects-row-content"><strong title={project.name}>{project.name}</strong><span>更新于 <time dateTime={project.updatedAt}>{formatDate(project.updatedAt)}</time></span></span>
        </Link>
        <button type="button" onClick={() => requestDelete(project.id)} aria-label={`删除 ${project.name}`} title="删除本地项目" className="projects-icon-button projects-delete-button" disabled={deleting}><Trash2 size={16} aria-hidden="true" /></button>
      </li>)}</ul>}
    <DeleteProjectDialog open={pendingId !== null} deleting={deleting} onConfirm={confirmDelete} onCancel={cancelDelete} />
  </section>;
}
