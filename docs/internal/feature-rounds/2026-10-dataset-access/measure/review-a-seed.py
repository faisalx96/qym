"""Review seed: schema + users for proxy-header auth (WP-A review). usage: review-a-seed.py DBURL"""
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from qym_platform.db.base import Base
from qym_platform.db.models import Project, ProjectMembership, ProjectRole, User, UserRole
e = create_engine(sys.argv[1]); Base.metadata.create_all(e)
with sessionmaker(bind=e)() as db:
    for i, n, r in [("admin","Ada Admin",UserRole.ADMIN),("mgr","Mona Manager",UserRole.MEMBER),("mem","Sami Member",UserRole.MEMBER),("mem2","Lina Member",UserRole.MEMBER),("mem3","Omar Member",UserRole.MEMBER),("out","Olga Outsider",UserRole.MEMBER)]:
        db.add(User(id=i, email=f"{i}@x.com", display_name=n, role=r))
    db.add(Project(id="pa", name="Project A", slug="pa", created_by_user_id="admin", is_active=True))
    db.add(Project(id="pb", name="Project B", slug="pb", created_by_user_id="admin", is_active=True))
    db.flush()
    for u, p, r in [("mgr","pa",ProjectRole.MANAGER),("mem","pa",ProjectRole.MEMBER),("mem2","pa",ProjectRole.MEMBER),("mem3","pa",ProjectRole.MEMBER),("out","pb",ProjectRole.MEMBER)]:
        db.add(ProjectMembership(project_id=p, user_id=u, role=r))
    db.commit()
