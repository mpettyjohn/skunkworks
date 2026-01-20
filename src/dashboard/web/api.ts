/**
 * REST API for Web Dashboard
 *
 * Provides endpoints for project data and artifacts.
 */

import type { Express, Request, Response } from 'express';
import { getAllProjectStatuses, getProjectStatus, getFullProjectState, getArtifactContent, getProject } from '../index.js';

/**
 * Register API routes on the Express app
 */
export function registerApiRoutes(app: Express): void {
  // List all projects with status
  app.get('/api/projects', (_req: Request, res: Response) => {
    try {
      const projects = getAllProjectStatuses();
      res.json({ projects });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch projects',
      });
    }
  });

  // Get single project details
  app.get('/api/projects/:id', (req: Request, res: Response) => {
    try {
      const project = getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const status = getProjectStatus(project.path);
      const state = getFullProjectState(project.path);

      res.json({
        ...status,
        state,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch project',
      });
    }
  });

  // Get project spec
  app.get('/api/projects/:id/spec', (req: Request, res: Response) => {
    try {
      const project = getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const content = getArtifactContent(project.path, 'spec');
      if (!content) {
        res.status(404).json({ error: 'Spec not found' });
        return;
      }

      res.json({ content });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch spec',
      });
    }
  });

  // Get project architecture
  app.get('/api/projects/:id/architecture', (req: Request, res: Response) => {
    try {
      const project = getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const content = getArtifactContent(project.path, 'architecture');
      if (!content) {
        res.status(404).json({ error: 'Architecture not found' });
        return;
      }

      res.json({ content });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch architecture',
      });
    }
  });

  // Get project review
  app.get('/api/projects/:id/review', (req: Request, res: Response) => {
    try {
      const project = getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const content = getArtifactContent(project.path, 'review');
      if (!content) {
        res.status(404).json({ error: 'Review not found' });
        return;
      }

      res.json({ content });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch review',
      });
    }
  });
}
